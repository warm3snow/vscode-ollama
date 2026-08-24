import fetch from 'node-fetch';
import { SearchResult } from './types';
import { CacheService } from './services/cacheService';
import { RateLimiter } from './services/rateLimiter';

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;
const REQUEST_TIMEOUT = 10000; // 10s
const MAX_CONTENT_LENGTH = 1000; // 每个链接内容最大字符数

const delay = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
	let settled = false;
	let timer: ReturnType<typeof setTimeout>;
	const onAbort = () => {
		if (settled) {
			return;
		}
		settled = true;
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
		reject(new Error('Web search cancelled.'));
	};
	const finish = () => {
		if (settled) {
			return;
		}
		settled = true;
		signal?.removeEventListener('abort', onAbort);
		resolve();
	};
	timer = setTimeout(finish, ms);
	signal?.addEventListener('abort', onAbort, { once: true });
});

export interface SearchWebOptions {
	provider?: string;
	cacheTimeoutMinutes?: number;
	requestsPerMinute?: number;
	signal?: AbortSignal;
}

// 模块级缓存（跨调用共享）
const searchCache = new CacheService<{ results: SearchResult[]; context: string }>(60);
const pageCache = new CacheService<string>(1440); // 24 hours TTL for page content

// 限流器：默认 10 次/分钟，可随配置动态调整
let rateLimiter = new RateLimiter(60000, 10);

// 添加一个函数来格式化搜索结果供LLM分析
function prepareSearchContextForLLM(results: SearchResult[], contents: string[]): string {
	if (results.length === 0) {
		return 'No search results found.';
	}

	let context = 'Here are the search results with their contents:\n\n';
	results.forEach((result, index) => {
		context += `[${index + 1}] Title: ${result.title}\n`;
		context += `    URL: ${result.url}\n`;
		context += `    Summary: ${result.snippet}\n`;
		if (contents[index]) {
			context += `    Content: ${contents[index]}\n`;
		}
		context += '\n';
	});

	return context;
}

export const searchWeb = async (query: string, options: SearchWebOptions = {}): Promise<{ results: SearchResult[]; context: string }> => {
	const provider = options.provider || 'bing';
	const cacheTimeoutMinutes = options.cacheTimeoutMinutes ?? 60;
	const requestsPerMinute = options.requestsPerMinute ?? 10;
	if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) {
		throw new Error('requestsPerMinute must be greater than 0.');
	}
	if (options.signal?.aborted) {
		throw new Error('Web search cancelled.');
	}

	// 动态调整限流配置（配置变更时重建）
	if (rateLimiter.maxRequests !== requestsPerMinute) {
		rateLimiter = new RateLimiter(60000, requestsPerMinute);
	}
	// 动态调整搜索缓存 TTL
	if (searchCache.ttlMinutes !== cacheTimeoutMinutes) {
		searchCache.setTtlMinutes(cacheTimeoutMinutes);
	}

	// 检查缓存
	const cacheKey = `${provider}:${query}`;
	const cachedResults = searchCache.get(cacheKey);
	if (cachedResults) {
		return cachedResults;
	}

	// 检查限流
	await rateLimiter.waitForAvailability(options.signal);

	try {
		const results = await webSearchByProvider(provider, query, options.signal);
		if (results.length === 0) {
			return {
				results: [],
				context: 'No search results found.'
			};
		}

		// 获取页面内容（使用缓存）
		const contentPromises = results.slice(0, 3).map(async (result) => {
			const cachedContent = pageCache.get(result.url);
			if (cachedContent !== null) {
				return cachedContent;
			}

			try {
				const content = await fetchPageContent(result.url, options.signal);
				if (content) {
					pageCache.set(result.url, content);
				}
				return content;
			} catch (error) {
				if (options.signal?.aborted) {
					throw error;
				}
				console.error(`Failed to fetch content for ${result.url}:`, error);
				return '';
			}
		});

		const contents = await Promise.all(contentPromises);
		const searchResult = {
			results,
			context: prepareSearchContextForLLM(results, contents)
		};

		// 缓存搜索结果
		searchCache.set(cacheKey, searchResult);

		return searchResult;
	} catch (error) {
		console.error('Search failed:', error);
		throw error;
	}
};

async function webSearchByProvider(provider: string, query: string, signal?: AbortSignal): Promise<SearchResult[]> {
	switch (provider) {
		case 'bing':
			return webBingSearch(query, signal);
		default:
			return webBingSearch(query, signal);
	}
}

async function webBingSearch(query: string, signal?: AbortSignal): Promise<SearchResult[]> {
	let attempts = 0;
	while (attempts < RETRY_ATTEMPTS) {
		try {
			const searchResponse = await fetchWithTimeout(
				`https://www.bing.com/search?q=${encodeURIComponent(query)}`,
				{
					headers: {
						'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
						'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
						'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
					}
				},
				signal
			);

			if (!searchResponse.ok) {
				throw new Error(`Search failed with status: ${searchResponse.status}`);
			}

			const html = await searchResponse.text();

			// 使用正则表达式提取搜索结果
			const results: SearchResult[] = [];
			const resultRegex = /<li class="b_algo"[^>]*>[\s\S]*?<h2><a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/g;
			let match;
			let count = 0;

			while ((match = resultRegex.exec(html)) !== null && count < 5) {
				const url = match[1];
				const title = match[2].replace(/<[^>]+>/g, '').trim();
				const snippet = match[3].replace(/<[^>]+>/g, '').trim();

				// 过滤掉广告和无效结果
				if (title && url && !url.includes('go.microsoft.com') &&
					!results.some(r => r.url === url)) {
					results.push({ title, url, snippet });
					count++;
				}
			}

			// 如果没有找到任何结果，返回一个默认结果
			if (results.length === 0) {
				return [{
					title: `Search "${query}" on Bing`,
					url: `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
					snippet: `Click to search "${query}" on Bing`
				}];
			}

			return results;

		} catch (error) {
			if (signal?.aborted) {
				throw error;
			}
			console.error(`Bing search attempt ${attempts + 1} failed:`, error);
			attempts++;
			if (attempts === RETRY_ATTEMPTS) {
				console.error('All attempts failed for Bing search');
				return [];
			}
			await delay(RETRY_DELAY * attempts, signal);
		}
	}
	return [];
}

// 带超时的 fetch 封装
async function fetchWithTimeout(url: string, options: object, signal?: AbortSignal): Promise<any> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
	const onAbort = () => controller.abort();
	if (signal?.aborted) {
		controller.abort();
	} else {
		signal?.addEventListener('abort', onAbort, { once: true });
	}
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}

// 改进的网页内容获取函数，添加随机延迟和超时
async function fetchPageContent(url: string, signal?: AbortSignal): Promise<string> {
	// 添加随机延迟，避免过快请求
	const randomDelay = Math.random() * 1000 + 500; // 500-1500ms delay
	await delay(randomDelay, signal);

	try {
		const response = await fetchWithTimeout(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; SearchBot/1.0)',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			}
		}, signal);

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const html = await response.text();
		return cleanHtml(html);
	} catch (error) {
		if (signal?.aborted) {
			throw error;
		}
		console.error(`Error fetching ${url}:`, error);
		return '';
	}
}

// HTML清理函数
function cleanHtml(html: string): string {
	const cleanText = html
		.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
		.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	return cleanText.length > MAX_CONTENT_LENGTH
		? cleanText.substring(0, MAX_CONTENT_LENGTH) + '...'
		: cleanText;
}
