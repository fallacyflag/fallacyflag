// Diagnostic endpoint: shows what source material the RSS feeds actually return
// Trigger: /.netlify/functions/debug-sources
// DELETE after debugging

const GENERAL_FEEDS = [
  "https://feeds.npr.org/1014/rss.xml",
  "https://rss.politico.com/politics-news.xml",
  "https://thehill.com/feed/",
  "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml",
  "https://www.pbs.org/newshour/feeds/rss/politics",
  "https://abcnews.go.com/abcnews/politicsheadlines",
  "https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml",
  "https://moxie.foxnews.com/google-publisher/politics.xml",
];

async function fetchWithTimeout(url, opts = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function fetchRSS(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "FallacyFlag/1.0" }
    });
    if (!res.ok) return { url, error: `HTTP ${res.status}`, items: [] };
    const xml = await res.text();
    const items = parseRSSItems(xml);
    return { url: url.slice(0, 80), itemCount: items.length, items: items.slice(0, 3) };
  } catch (e) {
    return { url: url.slice(0, 80), error: e.message, items: [] };
  }
}

function parseRSSItems(xml) {
  const items = [];
  const regex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = regex.exec(xml)) !== null) {
    const block = m[1];
    const get = (tag) => {
      const r = block.match(new RegExp(`<${tag}[^>]*?>([\\s\\S]*?)<\\/${tag}>`));
      return r ? stripMarkup(r[1]) : "";
    };
    let link = get("link");
    if (!link) {
      const linkMatch = block.match(/<link[^>]*href="([^"]*)"/);
      if (linkMatch) link = linkMatch[1];
    }
    items.push({
      title: get("title"),
      description: get("description") ? get("description").slice(0, 200) : "(empty)",
      link: link ? link.slice(0, 100) : "(no link)",
      pubDate: get("pubDate"),
    });
  }
  return items.filter(it => it.title);
}

function stripMarkup(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

// Also test article fetching
async function fetchArticleText(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; FallacyFlag/1.0)" },
      redirect: "follow",
    }, 6000);
    if (!res.ok) return { error: `HTTP ${res.status}`, finalUrl: res.url };
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return { error: `Wrong content-type: ${ct}`, finalUrl: res.url };
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { finalUrl: res.url, textLength: text.length, preview: text.slice(0, 500) };
  } catch (e) {
    return { error: e.message };
  }
}

export default async (req) => {
  const feedResults = await Promise.all(GENERAL_FEEDS.map(fetchRSS));

  // Try fetching full text from first article link
  let articleTest = null;
  for (const feed of feedResults) {
    if (feed.items && feed.items.length > 0 && feed.items[0].link) {
      articleTest = await fetchArticleText(feed.items[0].link);
      articleTest.sourceLink = feed.items[0].link.slice(0, 100);
      break;
    }
  }

  return new Response(JSON.stringify({ feeds: feedResults, articleTest }, null, 2), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
};
