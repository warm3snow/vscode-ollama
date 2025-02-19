import fetch from 'node-fetch';
import { SearchResult } from './types';

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const searchWeb = async (provider: string, query: string): Promise<SearchResult[]> => {
    console.log(`Starting web search with provider: ${provider}, query: ${query}`);
    
    try {
        let results: SearchResult[];
        switch (provider.toLowerCase()) {
            case "duckduckgo":
                results = await webDuckDuckGoSearch(query);
                break;
            case "baidu":
                results = await webBaiduSearch(query);
                break;
            case "sogou":
                results = await webSogouSearch(query);
                break;
            case "brave":
                results = await webBraveSearch(query);
                break;
            case "searxng":
                results = await searxngSearch(query);
                break;
            case "brave-api":
                results = await braveAPISearch(query);
                break;
            default:
                console.log('Using default search provider: baidu');
                results = await webBaiduSearch(query);
        }
        
        console.log(`Search completed. Found ${results.length} results`);
        return results;
    } catch (error) {
        console.error('Search failed:', error);
        throw error;
    }
};

async function webDuckDuckGoSearch(query: string): Promise<SearchResult[]> {
    let attempts = 0;
    while (attempts < RETRY_ATTEMPTS) {
        try {
            // 使用 DuckDuckGo API 的替代方案
            const response = await fetch(
                'https://api.duckduckgo.com/?' + new URLSearchParams({
                    q: query,
                    format: 'json',
                    no_redirect: '1',
                    no_html: '1',
                    skip_disambig: '1'
                }),
                {
                    headers: {
                        'User-Agent': 'VSCode-Ollama/1.0'
                    }
                }
            );

            if (!response.ok) {
                throw new Error(`Search failed with status: ${response.status}`);
            }

            const data = await response.json();
            console.log('DuckDuckGo raw response:', data); // 添加日志

            const results: SearchResult[] = [];

            // 添加 Abstract 结果
            if (data.Abstract) {
                results.push({
                    title: data.Heading || query,
                    url: data.AbstractURL || '',
                    snippet: data.Abstract
                });
            }

            // 添加 RelatedTopics
            if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
                data.RelatedTopics
                    .filter((topic: any) => topic.FirstURL && topic.Text)
                    .slice(0, 4) // 只取前4个相关主题
                    .forEach((topic: any) => {
                        results.push({
                            title: topic.Text.split(' - ')[0] || topic.Text,
                            url: topic.FirstURL,
                            snippet: topic.Text
                        });
                    });
            }

            console.log('Processed search results:', results); // 添加日志
            return results;

        } catch (error) {
            console.error('DuckDuckGo search error:', error); // 添加错误日志
            attempts++;
            if (attempts === RETRY_ATTEMPTS) {
                console.error('All attempts failed for DuckDuckGo search');
                return [];
            }
            await delay(RETRY_DELAY * attempts);
        }
    }
    return [];
}

async function webBaiduSearch(query: string): Promise<SearchResult[]> {
    let attempts = 0;
    while (attempts < RETRY_ATTEMPTS) {
        try {
            // 使用百度搜索建议 API
            const response = await fetch(
                `https://www.baidu.com/sugrec?prod=pc&wd=${encodeURIComponent(query)}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'application/json',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
                }
            });

            if (!response.ok) {
                throw new Error(`Search failed with status: ${response.status}`);
            }

            const data = await response.json();
            console.log('Baidu raw response:', data);

            // 处理百度搜索建议的返回格式
            if (data.g && Array.isArray(data.g)) {
                const results = data.g.slice(0, 5).map((item: any) => {
                    // 提取更多信息（如果有）
                    const title = item.q;
                    const url = `https://www.baidu.com/s?wd=${encodeURIComponent(item.q)}`;
                    let snippet = item.q;

                    // 如果有额外描述信息，添加到 snippet 中
                    if (item.t) {
                        snippet = `${item.q} - ${item.t}`;
                    }

                    return {
                        title,
                        url,
                        snippet
                    };
                });

                // 如果有搜索结果，添加一个"查看更多"的结果
                if (results.length > 0) {
                    results.push({
                        title: `在百度搜索"${query}"的更多结果`,
                        url: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
                        snippet: `点击查看在百度搜索"${query}"的完整搜索结果`
                    });
                }

                return results;
            }

            // 如果没有搜索建议，返回一个直接搜索的链接
            return [{
                title: `搜索"${query}"`,
                url: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
                snippet: `点击在百度搜索"${query}"`
            }];

        } catch (error) {
            console.error('Baidu search error:', error);
            attempts++;
            if (attempts === RETRY_ATTEMPTS) {
                return [];
            }
            await delay(RETRY_DELAY * attempts);
        }
    }
    return [];
}

async function webBraveSearch(query: string): Promise<SearchResult[]> {
    let attempts = 0;
    while (attempts < RETRY_ATTEMPTS) {
        try {
            const response = await fetch(
                `https://search.brave.com/api/suggest?q=${encodeURIComponent(query)}`
            );

            if (!response.ok) {
                throw new Error(`Search failed with status: ${response.status}`);
            }

            const data = await response.json();
            return data[1]
                .slice(0, 5)
                .map((item: string) => ({
                    title: item,
                    url: `https://search.brave.com/search?q=${encodeURIComponent(item)}`,
                    snippet: item
                }));

        } catch (error) {
            attempts++;
            if (attempts === RETRY_ATTEMPTS) {
                console.error('Brave search error:', error);
                return [];
            }
            await delay(RETRY_DELAY * attempts);
        }
    }
    return [];
}

// 其他搜索引擎的实现可以根据需要添加
async function webGoogleSearch(query: string): Promise<SearchResult[]> {
    // 默认返回 DuckDuckGo 的结果，因为 Google 需要 API key
    return webDuckDuckGoSearch(query);
}

async function webSogouSearch(query: string): Promise<SearchResult[]> {
    // 实现搜狗搜索
    return [];
}

async function searxngSearch(query: string): Promise<SearchResult[]> {
    // 实现 SearXNG 搜索
    return [];
}

async function braveAPISearch(query: string): Promise<SearchResult[]> {
    // 实现 Brave API 搜索
    return [];
} 