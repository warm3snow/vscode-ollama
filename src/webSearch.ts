import fetch from 'node-fetch';
import { SearchResult } from './types';
import { getOllamaConfig } from './extension';
import { CacheService } from './services/cacheService';
import { RateLimiter } from './services/rateLimiter';

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

// 添加内容大小限制常量
const MAX_CONTENT_LENGTH = 1000; // 每个链接内容最大字符数

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 添加一个函数来格式化搜索结果供LLM分析
function prepareSearchContextForLLM(results: SearchResult[], contents: string[]): string {
    if (results.length === 0) {
        return "No search results found.";
    }

    let context = "Here are the search results with their contents:\n\n";
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

// 初始化服务
const searchCache = new CacheService<{results: SearchResult[], context: string}>(60); // 60 minutes TTL
const rateLimiter = new RateLimiter(60000, 10); // 10 requests per minute
const pageCache = new CacheService<string>(1440); // 24 hours TTL for page content

export const searchWeb = async (_provider: string, query: string): Promise<{results: SearchResult[], context: string}> => {
    console.log(`Starting web search, query: ${query}`);
    
    // 检查缓存
    const cacheKey = `${_provider}:${query}`;
    const cachedResults = searchCache.get(cacheKey);
    if (cachedResults) {
        console.log('Returning cached results');
        return cachedResults;
    }

    // 检查限流
    await rateLimiter.waitForAvailability();
    
    try {
        const results = await webBingSearch(query);
        if (results.length === 0) {
            return { 
                results: [], 
                context: "No search results found." 
            };
        }

        // 获取页面内容（使用缓存）
        const contentPromises = results.slice(0, 3).map(async (result) => {
            const cachedContent = pageCache.get(result.url);
            if (cachedContent !== null) {
                return cachedContent;
            }

            try {
                const content = await fetchPageContent(result.url);
                if (content) {
                    pageCache.set(result.url, content);
                }
                return content;
            } catch (error) {
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
    } catch (error: unknown) {
        console.error('Search failed:', error);
        throw error;
    }
};

async function webBingSearch(query: string): Promise<SearchResult[]> {
    let attempts = 0;
    while (attempts < RETRY_ATTEMPTS) {
        try {
            const searchResponse = await fetch(
                `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                    }
                }
            );

            if (!searchResponse.ok) {
                throw new Error(`Search failed with status: ${searchResponse.status}`);
            }

            const html = await searchResponse.text();
            console.log('Got Bing search results page');
            
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
            console.error(`Bing search attempt ${attempts + 1} failed:`, error);
            attempts++;
            if (attempts === RETRY_ATTEMPTS) {
                console.error('All attempts failed for Bing search');
                return [];
            }
            await delay(RETRY_DELAY * attempts);
        }
    }
    return [];
}

// 改进的网页内容获取函数，添加延迟
async function fetchPageContent(url: string): Promise<string> {
    // 添加随机延迟，避免过快请求
    const delay = Math.random() * 1000 + 500; // 500-1500ms delay
    await new Promise(resolve => setTimeout(resolve, delay));

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; SearchBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            timeout: 5000
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        return cleanHtml(html);
    } catch (error) {
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