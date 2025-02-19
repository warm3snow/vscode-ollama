import fetch from 'node-fetch';
import { SearchResult } from './types';

export async function searchWeb(query: string): Promise<SearchResult[]> {
    try {
        // Using DuckDuckGo API (no API key needed)
        const response = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`);
        if (!response.ok) {
            throw new Error('Search failed');
        }
        
        const data = await response.json();
        return data.RelatedTopics
            .slice(0, 5)
            .map((topic: any) => ({
                title: topic.Text.split(' - ')[0],
                url: topic.FirstURL,
                snippet: topic.Text
            }));
    } catch (error) {
        return [];
    }
} 