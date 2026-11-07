import assert from "node:assert/strict";
import test from "node:test";
import { WeatherNewsService } from "./weatherNews";

test("no selected city makes no provider requests and returns no weather or headlines", async (t) => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("A provider request must not be made without a city.");
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await new WeatherNewsService().getWeatherAndNews();

  assert.equal(requests, 0);
  assert.equal(result.city, "");
  assert.equal(result.weather, null);
  assert.deepEqual(result.news, []);
});

test("weather and local Google News RSS use geocoded city data and return at most five parsed stories", async (t) => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.startsWith("https://geocoding-api.open-meteo.com/")) {
      return Response.json({
        results: [{
          id: 1,
          name: "Lahore",
          latitude: 31.55,
          longitude: 74.34,
          country: "Pakistan",
          country_code: "PK",
        }],
      });
    }
    if (url.startsWith("https://api.open-meteo.com/")) {
      return Response.json({
        current: {
          temperature_2m: 24.4,
          relative_humidity_2m: 52,
          apparent_temperature: 25.1,
          is_day: 1,
          precipitation: 0,
          weather_code: 0,
          wind_speed_10m: 8,
        },
        daily: { temperature_2m_min: [19], temperature_2m_max: [29] },
      });
    }
    const items = Array.from({ length: 6 }, (_, index) =>
      `<item><title>Headline ${index + 1} &amp; update</title><link>https://news.example/${index + 1}</link><pubDate>Wed, 04 Nov 2026 08:00:00 GMT</pubDate><source>Example ${index + 1}</source></item>`
    ).join("");
    return new Response(`<rss><channel>${items}</channel></rss>`, { status: 200 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await new WeatherNewsService().getWeatherAndNews("Lahore");

  assert.equal(result.weather?.temperature, 24);
  assert.equal(result.weather?.tempMin, 19);
  assert.equal(result.country, "Pakistan");
  assert.equal(result.news.length, 5);
  assert.equal(result.news[0].title, "Headline 1 & update");
  assert.equal(result.news[0].source, "Example 1");
  assert.ok(requestedUrls.some((url) => url.includes("gl=PK")));
  assert.deepEqual(result.errors, []);
});

test("provider failures are reported without fabricated weather or headlines", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await new WeatherNewsService().getWeatherAndNews(
    "Lahore",
    31.55,
    74.34,
    "Pakistan",
    "celsius",
    "PK"
  );

  assert.equal(result.weather, null);
  assert.deepEqual(result.news, []);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /Weather unavailable/);
  assert.match(result.errors[1], /News unavailable/);
});

test("configured provider keys are only used as fallbacks when zero-key providers fail", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://api.open-meteo.com/") || url.startsWith("https://news.google.com/")) {
      return new Response("unavailable", { status: 503 });
    }
    if (url.startsWith("https://api.openweathermap.org/")) {
      assert.equal(new URL(url).searchParams.get("appid"), "manual-weather-key");
      return Response.json({
        main: { temp: 20, feels_like: 19, humidity: 50, temp_min: 17, temp_max: 23 },
        wind: { speed: 2 },
        weather: [{ id: 800, description: "clear sky", icon: "01d" }],
      });
    }
    assert.equal(url.startsWith("https://newsapi.org/"), true);
    assert.equal((init?.headers as Record<string, string>)["X-Api-Key"], "manual-news-key");
    return Response.json({
      articles: [{
        title: "Fallback headline",
        url: "https://news.example/fallback",
        source: { name: "Fallback Source" },
        publishedAt: "2026-11-04T08:00:00Z",
      }],
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const result = await new WeatherNewsService().getWeatherAndNews(
    "Lahore",
    31.55,
    74.34,
    "Pakistan",
    "celsius",
    "PK",
    "general",
    {
      customOpenWeatherKey: "manual-weather-key",
      customNewsApiKey: "manual-news-key",
    }
  );

  assert.equal(result.provider.weather, "open-weather-map");
  assert.equal(result.provider.news, "newsapi");
  assert.equal(result.weather?.temperature, 20);
  assert.equal(result.news[0].title, "Fallback headline");
  assert.deepEqual(result.errors, []);
});
