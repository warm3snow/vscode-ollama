import fetch from 'node-fetch';
import { SearchResult } from './types';
import { getOllamaConfig } from './extension'; // 确保导入 getOllamaConfig

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const searchWeb = async (provider: string, query: string): Promise<SearchResult[]> => {
    console.log(`Starting web search with provider: ${provider}, query: ${query}`);
    
    try {
        const { baseUrl } = getOllamaConfig();
        
        let results: SearchResult[];
        switch (provider.toLowerCase()) {
            case "duckduckgo":
                results = await webDuckDuckGoSearch(query, baseUrl);
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
                console.log('Using default search provider: duckduckgo');
                results = await webDuckDuckGoSearch(query, baseUrl);
        }
        
        console.log(`Search completed. Found ${results.length} results`);
        return results;
    } catch (error) {
        console.error('Search failed:', error);
        throw error;
    }
};

async function translateQuery(query: string, baseUrl: string): Promise<string> {
    try {
        const { model } = getOllamaConfig();
        const response = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: model,
                prompt: `Translate to English: "${query}". Only return the translated text, no explanations.`,
                stream: false,
                raw: true,
                max_tokens: 100,
            }),
        });

        if (!response.ok) {
            throw new Error(`Translation failed with status: ${response.status}`);
        }

        const data = await response.json();
        console.log('Translation response:', data);
        
        // 从响应中提取生成的文本
        const translatedText = data.response ? data.response.trim() : query;
        console.log('Translated text:', translatedText);
        
        return translatedText;
    } catch (error) {
        console.error('Error translating query:', error);
        return query; // 如果翻译失败，返回原始查询
    }
}

async function webDuckDuckGoSearch(query: string, baseUrl: string): Promise<SearchResult[]> {
    let attempts = 0;
    while (attempts < RETRY_ATTEMPTS) {
        try {
            const searchResponse = await fetch(
                `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml'
                    }
                }
            );

            if (!searchResponse.ok) {
                throw new Error(`Search failed with status: ${searchResponse.status}`);
            }

            const html = await searchResponse.text();
            console.log('Got DuckDuckGo search results page');
            
            // 使用更可靠的选择器来提取搜索结果
            const results: SearchResult[] = [];
            const resultRegex = /<div class="result[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
            let match;
            let count = 0;

            while ((match = resultRegex.exec(html)) !== null && count < 5) {
                const url = match[1];
                const title = match[2].replace(/<[^>]+>/g, '').trim();
                const snippet = match[3].replace(/<[^>]+>/g, '').trim();

                // 过滤掉广告和无效结果
                if (title && url && !url.includes('duckduckgo.com') && 
                    !results.some(r => r.url === url)) {
                    results.push({ title, url, snippet });
                    count++;
                }
            }

            // 如果没有找到任何结果，返回一个默认结果
            if (results.length === 0) {
                return [{
                    title: `Search "${query}" on DuckDuckGo`,
                    url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                    snippet: `Click to search "${query}" on DuckDuckGo`
                }];
            }

            return results;

        } catch (error) {
            console.error(`DuckDuckGo search attempt ${attempts + 1} failed:`, error);
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
    return webDuckDuckGoSearch(query, 'http://127.0.0.1:11434');
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

async function fetchPageContent(url: string): Promise<string | null> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // 移除脚本
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')   // 移除样式
            .replace(/<[^>]+>/g, ' ')  // 移除其他HTML标签
            .replace(/\s+/g, ' ')      // 合并空白字符
            .trim();                   // 移除首尾空白

        return cleanText;
    } catch (error) {
        console.error('Error fetching page content:', error);
        return null;
    }
} 