/**
 * Zero-API-Key Weather & News Service
 *
 * Weather: Open-Meteo API (Forecast & Geocoding) - completely free, no API keys needed.
 * News: Google News RSS feeds - parsed as XML, filtered by country/topic.
 * Optional provider keys are only used when their zero-key provider fails.
 */
import { DOMParser } from "@xmldom/xmldom";

export interface WeatherData {
  city: string;
  country: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  precipitation: number;
  weatherCode: number;
  weatherDescription: string;
  weatherIcon: string;
  isDay: boolean;
  tempMin: number;
  tempMax: number;
  temperatureUnit: string;
  updatedAt: string;
}

export interface NewsStory {
  id: string;
  title: string;
  source: string;
  link: string;
  pubDate: string;
}

export interface CitySearchResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  countryCode: string;
  admin1?: string;
}

export interface WeatherNewsPayload {
  weather: WeatherData | null;
  news: NewsStory[];
  city: string;
  country: string;
  lastUpdated: string;
  provider: {
    weather: "open-meteo" | "open-weather-map";
    news: "google-news-rss" | "newsapi";
  };
  errors: string[];
}

export interface WeatherNewsOptions {
  customOpenWeatherKey?: string;
  customNewsApiKey?: string;
}

// WMO Weather Interpretation Codes (WW)
const WMO_CODES: Record<number, { description: string; icon: string }> = {
  0: { description: "Clear sky", icon: "☀️" },
  1: { description: "Mainly clear", icon: "🌤️" },
  2: { description: "Partly cloudy", icon: "⛅" },
  3: { description: "Overcast", icon: "☁️" },
  45: { description: "Foggy", icon: "🌫️" },
  48: { description: "Depositing rime fog", icon: "🌫️" },
  51: { description: "Light drizzle", icon: "🌦️" },
  53: { description: "Moderate drizzle", icon: "🌦️" },
  55: { description: "Dense drizzle", icon: "🌧️" },
  56: { description: "Light freezing drizzle", icon: "🌨️" },
  57: { description: "Dense freezing drizzle", icon: "🌨️" },
  61: { description: "Slight rain", icon: "🌦️" },
  63: { description: "Moderate rain", icon: "🌧️" },
  65: { description: "Heavy rain", icon: "🌧️" },
  66: { description: "Light freezing rain", icon: "🌨️" },
  67: { description: "Heavy freezing rain", icon: "🌨️" },
  71: { description: "Slight snow fall", icon: "🌨️" },
  73: { description: "Moderate snow fall", icon: "❄️" },
  75: { description: "Heavy snow fall", icon: "❄️" },
  77: { description: "Snow grains", icon: "❄️" },
  80: { description: "Slight rain showers", icon: "🌦️" },
  81: { description: "Moderate rain showers", icon: "🌧️" },
  82: { description: "Violent rain showers", icon: "⛈️" },
  85: { description: "Slight snow showers", icon: "🌨️" },
  86: { description: "Heavy snow showers", icon: "❄️" },
  95: { description: "Thunderstorm", icon: "⛈️" },
  96: { description: "Thunderstorm with slight hail", icon: "⛈️" },
  99: { description: "Thunderstorm with heavy hail", icon: "⛈️" },
};

export class WeatherNewsService {
  private cache = new Map<string, { data: unknown; expiresAt: number }>();
  private readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache

  private getCached<T>(key: string): T | undefined {
    const cached = this.cache.get(key);
    return cached && cached.expiresAt > Date.now() ? cached.data as T : undefined;
  }

  private setCached<T>(key: string, data: T, ttl = this.CACHE_TTL_MS): void {
    this.cache.set(key, { data, expiresAt: Date.now() + ttl });
  }

  /**
   * Search global cities using Open-Meteo Geocoding API (Zero-API-Key)
   */
  async searchCities(query: string): Promise<CitySearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) return [];

    const cacheKey = `city_search:${trimmed.toLowerCase()}`;
    const cached = this.getCached<CitySearchResult[]>(cacheKey);
    if (cached) return cached;

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      trimmed
    )}&count=8&language=en&format=json`;
    const res = await fetch(url, { headers: { "User-Agent": "JAYRA-HUD/1.0" } });
    if (!res.ok) throw new Error(`Geocoding HTTP error ${res.status}`);
    const json: unknown = await res.json();
    const rawResults = (json as { results?: unknown } | null)?.results;
    const results: CitySearchResult[] = Array.isArray(rawResults)
      ? rawResults.flatMap((entry): CitySearchResult[] => {
          if (!entry || typeof entry !== "object") return [];
          const result = entry as Record<string, unknown>;
          if (
            typeof result.id !== "number" ||
            typeof result.name !== "string" ||
            typeof result.latitude !== "number" ||
            typeof result.longitude !== "number"
          ) return [];
          return [{
            id: result.id,
            name: result.name,
            latitude: result.latitude,
            longitude: result.longitude,
            country: typeof result.country === "string" ? result.country : "",
            countryCode: typeof result.country_code === "string" ? result.country_code : "",
            admin1: typeof result.admin1 === "string" ? result.admin1 : "",
          }];
        })
      : [];

    this.setCached(cacheKey, results, 60 * 60 * 1000);
    return results;
  }

  /**
   * Fetch current weather and daily forecast from Open-Meteo (Zero-API-Key)
   */
  private async getWeather(
    lat: number,
    lon: number,
    cityName: string,
    countryName: string = "",
    tempUnit: "celsius" | "fahrenheit" = "celsius",
    fallbackKey?: string
  ): Promise<{ weather: WeatherData; provider: "open-meteo" | "open-weather-map" }> {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      throw new Error("Weather coordinates are invalid.");
    }
    const cacheKey = `weather:${lat.toFixed(2)}:${lon.toFixed(2)}:${tempUnit}`;
    const cached = this.getCached<{ weather: WeatherData; provider: "open-meteo" | "open-weather-map" }>(cacheKey);
    if (cached) return cached;

    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=${tempUnit}&timezone=auto`;
      const res = await fetch(url, { headers: { "User-Agent": "JAYRA-HUD/1.0" } });
      if (!res.ok) throw new Error(`Weather HTTP error ${res.status}`);
      const json: unknown = await res.json();
      const data = json as {
        current?: Record<string, unknown>;
        daily?: { temperature_2m_min?: unknown[]; temperature_2m_max?: unknown[] };
      };
      const current = data.current;
      const daily = data.daily;
      const numeric = (value: unknown, label: string): number => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(`Weather response is missing ${label}.`);
        }
        return value;
      };
      if (!current || !daily) throw new Error("Weather response is incomplete.");
      const code = numeric(current.weather_code, "weather code");
      const temperature = numeric(current.temperature_2m, "temperature");
      const meta = WMO_CODES[code] || { description: "Unknown conditions", icon: "☁️" };
      const weather: WeatherData = {
        city: cityName,
        country: countryName,
        temperature: Math.round(temperature),
        apparentTemperature: Math.round(numeric(current.apparent_temperature, "apparent temperature")),
        humidity: Math.round(numeric(current.relative_humidity_2m, "humidity")),
        windSpeed: Math.round(numeric(current.wind_speed_10m, "wind speed")),
        precipitation: numeric(current.precipitation, "precipitation"),
        weatherCode: code,
        weatherDescription: meta.description,
        weatherIcon: meta.icon,
        isDay: numeric(current.is_day, "daylight status") === 1,
        tempMin: Math.round(numeric(daily.temperature_2m_min?.[0], "daily minimum temperature")),
        tempMax: Math.round(numeric(daily.temperature_2m_max?.[0], "daily maximum temperature")),
        temperatureUnit: tempUnit === "fahrenheit" ? "°F" : "°C",
        updatedAt: new Date().toISOString(),
      };
      const result = { weather, provider: "open-meteo" as const };
      this.setCached(cacheKey, result);
      return result;
    } catch (primaryError) {
      if (!fallbackKey) throw primaryError;
      try {
        const url = new URL("https://api.openweathermap.org/data/2.5/weather");
        url.searchParams.set("lat", String(lat));
        url.searchParams.set("lon", String(lon));
        url.searchParams.set("units", tempUnit === "fahrenheit" ? "imperial" : "metric");
        url.searchParams.set("appid", fallbackKey);
        const res = await fetch(url, { headers: { "User-Agent": "JAYRA-HUD/1.0" } });
        if (!res.ok) throw new Error(`OpenWeatherMap HTTP error ${res.status}`);
        const json: unknown = await res.json();
        const data = json as {
          main?: Record<string, unknown>;
          wind?: Record<string, unknown>;
          weather?: Array<{ id?: unknown; description?: unknown; icon?: unknown }>;
          rain?: Record<string, unknown>;
          snow?: Record<string, unknown>;
        };
        const main = data.main;
        const current = data.weather?.[0];
        const number = (value: unknown, label: string): number => {
          if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new Error(`OpenWeatherMap response is missing ${label}.`);
          }
          return value;
        };
        if (!main || !current) throw new Error("OpenWeatherMap response is incomplete.");
        const conditionId = number(current.id, "weather code");
        const code = conditionId >= 200 && conditionId < 300 ? 95
          : conditionId >= 300 && conditionId < 400 ? 51
            : conditionId >= 500 && conditionId < 600 ? (conditionId >= 502 ? 65 : conditionId >= 501 ? 63 : 61)
              : conditionId >= 600 && conditionId < 700 ? 71
                : conditionId >= 700 && conditionId < 800 ? 45
                  : conditionId === 800 ? 0
                    : conditionId <= 802 ? 2 : 3;
        const meta = WMO_CODES[code] || { description: "Unknown conditions", icon: "☁️" };
        const imperial = tempUnit === "fahrenheit";
        const precipitation = data.rain?.["1h"] ?? data.snow?.["1h"] ?? 0;
        const weather: WeatherData = {
          city: cityName,
          country: countryName,
          temperature: Math.round(number(main.temp, "temperature")),
          apparentTemperature: Math.round(number(main.feels_like, "apparent temperature")),
          humidity: Math.round(number(main.humidity, "humidity")),
          windSpeed: Math.round(number(data.wind?.speed, "wind speed") * (imperial ? 1.60934 : 3.6)),
          precipitation: typeof precipitation === "number" ? precipitation : 0,
          weatherCode: code,
          weatherDescription: typeof current.description === "string" ? current.description : meta.description,
          weatherIcon: meta.icon,
          isDay: typeof current.icon === "string" ? current.icon.endsWith("d") : true,
          tempMin: Math.round(number(main.temp_min, "minimum temperature")),
          tempMax: Math.round(number(main.temp_max, "maximum temperature")),
          temperatureUnit: imperial ? "°F" : "°C",
          updatedAt: new Date().toISOString(),
        };
        const result = { weather, provider: "open-weather-map" as const };
        this.setCached(cacheKey, result);
        return result;
      } catch (fallbackError) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`${primaryMessage}; OpenWeatherMap fallback failed: ${fallbackMessage}`);
      }
    }
  }

  /**
   * Fetch top news headlines via Google News RSS (Zero-API-Key)
   */
  private async getNews(
    countryCode: string,
    category = "general",
    fallbackKey?: string
  ): Promise<{ news: NewsStory[]; provider: "google-news-rss" | "newsapi" }> {
    if (!/^[A-Z]{2}$/i.test(countryCode)) {
      throw new Error("A selected city with a country code is required for regional headlines.");
    }
    const gl = countryCode.toUpperCase();
    const normalizedCategory = ["technology", "science", "business"].includes(category) ? category : "general";
    const cacheKey = `news:${gl}:${normalizedCategory}`;
    const cached = this.getCached<{ news: NewsStory[]; provider: "google-news-rss" | "newsapi" }>(cacheKey);
    if (cached) return cached;

    const locale = `hl=en&gl=${gl}&ceid=${gl}:en`;
    const url = normalizedCategory === "general"
      ? `https://news.google.com/rss?${locale}`
      : `https://news.google.com/rss/search?q=${encodeURIComponent(normalizedCategory)}&${locale}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 JAYRA-HUD/1.0" } });
      if (!res.ok) throw new Error(`Google News RSS error ${res.status}`);
      const xml = await res.text();
      if (/<!DOCTYPE/i.test(xml)) throw new Error("Google News RSS contains a disallowed document type.");

      let parseError = "";
      const document = new DOMParser({
        onError: (level, message) => {
          if (level === "error" || level === "fatalError") parseError = message;
        },
      }).parseFromString(xml, "text/xml");
      if (parseError) throw new Error(`Could not parse Google News RSS: ${parseError}`);

      const items = document.getElementsByTagName("item");
      const stories: NewsStory[] = [];
      for (let i = 0; i < items.length && stories.length < 5; i++) {
        const item = items.item(i);
        if (!item) continue;
        const text = (tag: string) => item.getElementsByTagName(tag).item(0)?.textContent?.trim() || "";
        const title = text("title");
        const link = text("link");
        const source = text("source");
        const pubDate = text("pubDate");
        let safeLink: URL;
        try {
          safeLink = new URL(link);
        } catch {
          continue;
        }
        if (!title || !["http:", "https:"].includes(safeLink.protocol)) continue;
        const published = Date.parse(pubDate);
        stories.push({
          id: `story-${i}-${safeLink.href}`,
          title,
          source: source || "Google News",
          link: safeLink.href,
          pubDate: Number.isFinite(published) ? new Date(published).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recent",
        });
      }
      const result = { news: stories, provider: "google-news-rss" as const };
      this.setCached(cacheKey, result);
      return result;
    } catch (primaryError) {
      if (!fallbackKey) throw primaryError;
      try {
        const params = new URLSearchParams({
          country: gl.toLowerCase(),
          category: normalizedCategory,
          pageSize: "5",
        });
        const res = await fetch(`https://newsapi.org/v2/top-headlines?${params}`, {
          headers: { "X-Api-Key": fallbackKey, "User-Agent": "JAYRA-HUD/1.0" },
        });
        if (!res.ok) throw new Error(`NewsAPI HTTP error ${res.status}`);
        const json: unknown = await res.json();
        const articles = (json as { articles?: unknown } | null)?.articles;
        const stories: NewsStory[] = Array.isArray(articles)
          ? articles.flatMap((entry, index): NewsStory[] => {
              if (!entry || typeof entry !== "object") return [];
              const article = entry as Record<string, unknown>;
              if (typeof article.title !== "string" || typeof article.url !== "string") return [];
              let link: URL;
              try {
                link = new URL(article.url);
              } catch {
                return [];
              }
              if (!["http:", "https:"].includes(link.protocol)) return [];
              const source = article.source && typeof article.source === "object"
                ? (article.source as Record<string, unknown>).name
                : undefined;
              const published = typeof article.publishedAt === "string" ? Date.parse(article.publishedAt) : NaN;
              return [{
                id: `newsapi-${index}-${link.href}`,
                title: article.title,
                source: typeof source === "string" ? source : "NewsAPI",
                link: link.href,
                pubDate: Number.isFinite(published) ? new Date(published).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Recent",
              }];
            }).slice(0, 5)
          : [];
        const result = { news: stories, provider: "newsapi" as const };
        this.setCached(cacheKey, result);
        return result;
      } catch (fallbackError) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`${primaryMessage}; NewsAPI fallback failed: ${fallbackMessage}`);
      }
    }
  }

  /**
   * Combined Payload for HUD Widget & AI Context
   */
  async getWeatherAndNews(
    city?: string,
    lat?: number,
    lon?: number,
    country?: string,
    tempUnit: "celsius" | "fahrenheit" = "celsius",
    countryCode = "",
    newsCategory = "general",
    fallbacks: WeatherNewsOptions = {}
  ): Promise<WeatherNewsPayload> {
    let targetLat = lat;
    let targetLon = lon;
    let targetCity = city || "";
    let targetCountry = country || "";
    let targetCountryCode = countryCode;
    const errors: string[] = [];

    // If city is specified without coordinates, geocode it
    const coordinatesMissing =
      targetLat === undefined ||
      targetLon === undefined ||
      (targetLat === 0 && targetLon === 0);
    if (targetCity && (coordinatesMissing || !targetCountryCode)) {
      try {
        const search = await this.searchCities(targetCity);
        if (search.length > 0) {
          if (coordinatesMissing) {
            targetLat = search[0].latitude;
            targetLon = search[0].longitude;
            targetCity = search[0].name;
          }
          targetCountry = targetCountry || search[0].country;
          targetCountryCode = targetCountryCode || search[0].countryCode;
        } else {
          errors.push(`No location found for "${targetCity}".`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`City lookup failed: ${message}`);
      }
    }

    let weather: WeatherData | null = null;
    let weatherProvider: WeatherNewsPayload["provider"]["weather"] = "open-meteo";
    if (typeof targetLat === "number" && typeof targetLon === "number" && targetCity) {
      try {
        const result = await this.getWeather(
          targetLat,
          targetLon,
          targetCity,
          targetCountry,
          tempUnit,
          fallbacks.customOpenWeatherKey
        );
        weather = result.weather;
        weatherProvider = result.provider;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Weather unavailable: ${message}`);
      }
    } else if (targetCity) {
      errors.push(`Weather coordinates are unavailable for "${targetCity}".`);
    }

    let news: NewsStory[] = [];
    let newsProvider: WeatherNewsPayload["provider"]["news"] = "google-news-rss";
    if (!targetCity) {
      errors.push("No city is selected; regional headlines were not requested.");
    } else {
      try {
        const result = await this.getNews(targetCountryCode, newsCategory, fallbacks.customNewsApiKey);
        news = result.news;
        newsProvider = result.provider;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`News unavailable: ${message}`);
      }
    }

    return {
      weather,
      news,
      city: targetCity,
      country: targetCountry,
      lastUpdated: new Date().toISOString(),
      provider: {
        weather: weatherProvider,
        news: newsProvider,
      },
      errors,
    };
  }
}

export const weatherNewsService = new WeatherNewsService();
