import fetch from 'node-fetch';
import { SearchResult } from './types';
import { getOllamaConfig } from './extension';

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const searchWeb = async (_provider: string, query: string): Promise<SearchResult[]> => {
    console.log(`Starting web search with Bing, query: ${query}`);
    
    try {
        return await webBingSearch(query);
    } catch (error) {
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

async function fetchPageContent(url: string): Promise<string | null> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch page: ${response.status}`);
        }

        const html = await response.text();
        
        // 提取主要文本内容
        const cleanText = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return cleanText;
    } catch (error) {
        console.error('Error fetching page content:', error);
        return null;
    }
} 