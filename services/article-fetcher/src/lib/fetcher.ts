import axios from 'axios';

const USER_AGENT = 'NewsAggregatorBot/1.0 (+http://localhost:3000/bot)';

export async function fetchPage(url: string): Promise<string | null> {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            timeout: 10000, // 10s timeout
            maxRedirects: 5
        });

        if (response.status === 200) {
            return response.data;
        }
        return null;
    } catch (error: any) {
        console.error(`Failed to fetch ${url}: ${error.message}`);
        return null;
    }
}
