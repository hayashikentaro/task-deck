import { Tool, ToolType } from "../types/tool";

interface YahooNewsResponse {
  articles: Array<{
    title: string;
    url: string;
    publishedDate: string;
  }>;
}

export class YahooNewsTool implements Tool {
  name = "yahooNews";
  type = ToolType.webSearch;
  description = "取得 Yahoo! ヘッドラインニュースを取得します";

  async execute(): Promise<YahooNewsResponse | Error> {
    // TODO: Yahoo API を使用してヘッドラインニュースを取得する実装を追加します
    // 現在の実装ではダミーのデータを返します
    
    const dummyNews: YahooNewsResponse = {
      articles: [
        {
          title: "ヘッドラインニュース 1",
          url: "https://news.yahoo.co.jp/articles/0000000001",
          publishedDate: new Date().toISOString()
        },
        {
          title: "ヘッドラインニュース 2",
          url: "https://news.yahoo.co.jp/articles/0000000002",
          publishedDate: new Date().toISOString()
        },
        {
          title: "ヘッドラインニュース 3",
          url: "https://news.yahoo.co.jp/articles/0000000003",
          publishedDate: new Date().toISOString()
        }
      ]
    };

    return dummyNews;
  }
}