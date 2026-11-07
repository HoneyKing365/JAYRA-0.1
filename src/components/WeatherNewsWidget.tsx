/**
 * JAYRA Weather & News HUD Widget
 *
 * Lightweight, zero-API-key integration powered by Open-Meteo & Google News RSS.
 * Features:
 *  - Compact top-right HUD pill with real-time temperature, condition icon, and city.
 *  - First-time setup city selection prompt.
 *  - High-fidelity dark-glass flyout with:
 *      * Detailed weather metrics (apparent temp, humidity, wind speed, daily min/max).
 *      * Live headline news feed with direct source links.
 *      * Integrated global city search & switcher.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Sun,
  Cloud,
  CloudSun,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudFog,
  Wind,
  Droplets,
  Thermometer,
  Compass,
  MapPin,
  RefreshCw,
  ExternalLink,
  Search,
  X,
  Newspaper,
  Check,
} from "lucide-react";
import type { AppSettings, AppSettingsPatch } from "../lib/appApi";
import { api } from "../lib/appApi";
import { reportDiagnostic } from "../lib/diagnostics";

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

interface WeatherNewsWidgetProps {
  appSettings: AppSettings | null;
  onUpdateSettings?: (patch: AppSettingsPatch) => Promise<void> | void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getWeatherLucideIcon(code: number, isDay: boolean = true) {
  if (code === 0) return isDay ? <Sun size={14} className="text-amber-400" /> : <Sun size={14} className="text-slate-300" />;
  if (code >= 1 && code <= 3) return <CloudSun size={14} className="text-amber-300" />;
  if (code === 45 || code === 48) return <CloudFog size={14} className="text-slate-400" />;
  if (code >= 51 && code <= 67) return <CloudRain size={14} className="text-cyan-400" />;
  if (code >= 71 && code <= 77) return <CloudSnow size={14} className="text-sky-200" />;
  if (code >= 80 && code <= 82) return <CloudRain size={14} className="text-cyan-400" />;
  if (code >= 95) return <CloudLightning size={14} className="text-yellow-400" />;
  return <Cloud size={14} className="text-slate-400" />;
}

export const WeatherNewsWidget: React.FC<WeatherNewsWidgetProps> = ({
  appSettings,
  onUpdateSettings,
  open,
  onOpenChange,
}) => {
  const [activeTab, setActiveTab] = useState<"overview" | "search">("overview");
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [news, setNews] = useState<NewsStory[]>([]);
  const [provider, setProvider] = useState<{ weather: string; news: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [dataError, setDataError] = useState("");
  const [searchError, setSearchError] = useState("");

  // City Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CitySearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const searchTimeoutRef = useRef<any>(null);

  const city = appSettings?.weatherNews?.city || "";
  const country = appSettings?.weatherNews?.country || "";
  const lat = appSettings?.weatherNews?.latitude;
  const lon = appSettings?.weatherNews?.longitude;
  const tempUnit = appSettings?.weatherNews?.temperatureUnit || "celsius";
  const newsCategory = appSettings?.weatherNews?.newsCategory || "general";

  const updateWeatherSettings = async (weatherNews: NonNullable<AppSettingsPatch["weatherNews"]>) => {
    const patch: AppSettingsPatch = { weatherNews };
    if (onUpdateSettings) await onUpdateSettings(patch);
    else await api.updateAppSettings(patch);
  };

  // Fetch Weather & News
  const fetchData = useCallback(async () => {
    if (!city) {
      setWeather(null);
      setNews([]);
      setProvider(null);
      setDataError("");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const q = new URLSearchParams();
      q.set("city", city);
      if (country) q.set("country", country);
      if (typeof lat === "number") q.set("lat", String(lat));
      if (typeof lon === "number") q.set("lon", String(lon));
      q.set("unit", tempUnit);
      q.set("category", newsCategory);

      const res = await fetch(`/api/weather-news?${q.toString()}`);
      if (!res.ok) throw new Error("HTTP error " + res.status);
      const data = await res.json() as {
        weather?: WeatherData | null;
        news?: NewsStory[];
        provider?: { weather: string; news: string };
        errors?: string[];
      };
      setWeather(data.weather || null);
      setNews(Array.isArray(data.news) ? data.news : []);
      setProvider(data.provider || null);
      setDataError(Array.isArray(data.errors) ? data.errors.join(" ") : "");
      for (const error of data.errors || []) {
        reportDiagnostic("Weather/news data unavailable", error, "warning");
      }
      setLastRefreshed(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load weather and headlines.";
      reportDiagnostic("Weather/news request failed", message, "warning");
      setDataError(message);
    } finally {
      setIsLoading(false);
    }
  }, [city, country, lat, lon, tempUnit, newsCategory]);

  // Initial fetch and auto-refresh interval
  useEffect(() => {
    if (city) {
      setWeather(null);
      setNews([]);
      setProvider(null);
      setDataError("");
      void fetchData();
      const intervalMinutes = appSettings?.weatherNews?.autoRefreshMinutes || 30;
      const interval = setInterval(() => {
        void fetchData();
      }, intervalMinutes * 60 * 1000);
      return () => clearInterval(interval);
    } else {
    setWeather(null);
    setNews([]);
    setProvider(null);
    setDataError("");
    setIsLoading(false);
    // First time without city: switch tab to search when opened
    setActiveTab("search");
    }
  }, [city, fetchData, appSettings?.weatherNews?.autoRefreshMinutes]);

  useEffect(() => () => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
  }, []);

  // Click outside to close flyout
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !drawerRef.current?.contains(target)) {
        onOpenChange(false);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, [open, onOpenChange]);

  // Debounced City Search
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setSearchError("");
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!val.trim() || val.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cities/search?q=${encodeURIComponent(val.trim())}`);
        if (!res.ok) throw new Error(`City search failed (${res.status}).`);
        const json = await res.json();
        setSearchResults(json.results || []);
      } catch (error) {
        setSearchResults([]);
        const message = error instanceof Error ? error.message : "City search failed.";
        reportDiagnostic("City search failed", message, "warning");
        setSearchError(message);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  };

  // Select City Handler
  const handleSelectCity = async (selected: CitySearchResult) => {
    const patchPayload: AppSettingsPatch = {
      weatherNews: {
        city: selected.name,
        country: selected.country,
        countryCode: selected.countryCode,
        latitude: selected.latitude,
        longitude: selected.longitude,
      },
    };

    try {
      await updateWeatherSettings(patchPayload.weatherNews);
      setSearchQuery("");
      setSearchResults([]);
      setSearchError("");
      setActiveTab("overview");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Could not save the selected city.");
    }
  };

  return (
    <div className="relative inline-block font-sans" ref={panelRef}>
      {/* 1. Compact HUD Pill Button */}
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-label={city ? `Weather and news for ${city}` : "Select your city for weather and news"}
        className={`flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-mono transition-[border-color,background-color,color,box-shadow] duration-200 border cursor-pointer select-none ${
          open
            ? "border-cyan-400/60 bg-cyan-950/40 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.25)]"
            : "border-white/10 bg-black/40 text-slate-300 hover:border-cyan-500/40 hover:bg-white/5 hover:text-white"
        }`}
        title={city ? `${city} Weather & News` : "Select City for Weather & News"}
      >
        {weather ? (
          <>
            <span className="flex items-center gap-1">
              {getWeatherLucideIcon(weather.weatherCode, weather.isDay)}
              <span className="font-semibold text-white">
                {weather.temperature}
                {weather.temperatureUnit}
              </span>
            </span>
            <span className="text-white/30 text-[10px]">|</span>
            <span className="truncate max-w-[90px] text-slate-300">{weather.city}</span>
          </>
        ) : city ? (
          <>
            <MapPin size={12} className="text-cyan-400" />
            <span className="truncate max-w-[90px] text-slate-300">{city}</span>
          </>
        ) : (
          <>
            <MapPin size={12} className="text-cyan-400 animate-pulse" />
            <span className="text-cyan-300 font-semibold tracking-wider text-[11px]">SELECT CITY</span>
          </>
        )}
      </button>

      {/* 2. Flyout Glass Panel */}
      {open && createPortal(
        <aside ref={drawerRef} aria-label={`Weather and news for ${city || "a city"}`} className="jayra-weather-drawer fixed right-4 top-20 bottom-36 z-[130] flex w-[min(90vw,400px)] flex-col overflow-y-auto overscroll-contain rounded-2xl border border-white/15 bg-slate-950/95 text-slate-200 shadow-2xl backdrop-blur-2xl animate-in fade-in slide-in-from-right-2 duration-200">
          {/* Header Bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.03]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
              <div className="text-[11px] font-mono font-bold tracking-widest uppercase text-white/90">
                {activeTab === "search" ? (city ? "CHANGE CITY" : "SELECT YOUR CITY") : "WEATHER & HEADLINES"}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {city && (
                <button
                  type="button"
                  onClick={() => setActiveTab((t) => (t === "overview" ? "search" : "overview"))}
                  className="px-2 py-0.5 rounded text-[10px] font-mono border border-white/10 hover:border-cyan-400/50 hover:bg-white/5 text-slate-300 transition"
                  title="Switch city"
                >
                  {activeTab === "search" ? "VIEW WEATHER" : "EDIT CITY"}
                </button>
              )}

              <button
                type="button"
                onClick={fetchData}
                disabled={isLoading || !city}
                className={`p-1 text-slate-400 hover:text-cyan-300 transition rounded hover:bg-white/5 ${
                  isLoading ? "animate-spin text-cyan-400" : ""
                }`}
                aria-label="Refresh weather and news"
                title="Refresh Weather & News"
              >
                <RefreshCw size={13} />
              </button>

              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close weather and news"
                className="p-1 text-slate-400 hover:text-white transition-colors rounded hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* TAB 1: City Search & Switcher */}
          {activeTab === "search" && (
            <div className="p-4 space-y-3">
              <div className="text-xs text-slate-400">
                Type any city in the world to load free, real-time weather and local Google News headlines:
              </div>

              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  aria-label="Search for a city"
                  name="city"
                  autoComplete="off"
                  placeholder="e.g. Lahore, Karachi, London, New York..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-black/50 border border-white/15 focus:border-cyan-400/60 outline-none text-white placeholder-slate-500 font-mono"
                />
                {isSearching && (
                  <RefreshCw
                    size={12}
                    className="absolute right-3 top-3 animate-spin text-cyan-400"
                  />
                )}
              </div>

              {/* City Results Dropdown */}
              {searchError && <p role="alert" className="text-xs text-rose-300">{searchError}</p>}

              <div className="max-h-56 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                {searchResults.length > 0 ? (
                  searchResults.map((res) => (
                    <button
                      key={res.id}
                      type="button"
                      onClick={() => handleSelectCity(res)}
                      className="w-full flex items-center justify-between p-2 rounded-xl text-left border border-transparent hover:border-cyan-500/30 hover:bg-cyan-950/30 transition text-xs group"
                    >
                      <div>
                        <div className="font-semibold text-white group-hover:text-cyan-300">
                          {res.name}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {[res.admin1, res.country].filter(Boolean).join(", ")}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-400/60 group-hover:text-cyan-300">
                        Select →
                      </span>
                    </button>
                  ))
                ) : searchQuery.length >= 2 && !isSearching ? (
                  <div className="py-4 text-center text-xs text-slate-500">
                    No cities matching &ldquo;{searchQuery}&rdquo;
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* TAB 2: Weather & News Overview */}
          {activeTab === "overview" && (
            <div className="p-4 space-y-4 max-h-[520px] overflow-y-auto custom-scrollbar">
              <div className="grid grid-cols-2 gap-2">
                <label className="text-[10px] font-mono uppercase tracking-wide text-slate-400">
                  Temperature
                  <select
                    value={tempUnit}
                    onChange={(event) => void updateWeatherSettings({ temperatureUnit: event.target.value as "celsius" | "fahrenheit" }).catch((error) => {
                      reportDiagnostic("Weather preference update failed", error instanceof Error ? error.message : String(error), "warning");
                    })}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs normal-case tracking-normal text-slate-100"
                  >
                    <option value="celsius">Celsius (°C)</option>
                    <option value="fahrenheit">Fahrenheit (°F)</option>
                  </select>
                </label>
                <label className="text-[10px] font-mono uppercase tracking-wide text-slate-400">
                  News category
                  <select
                    value={newsCategory}
                    onChange={(event) => void updateWeatherSettings({ newsCategory: event.target.value as AppSettings["weatherNews"]["newsCategory"] }).catch((error) => {
                      reportDiagnostic("News preference update failed", error instanceof Error ? error.message : String(error), "warning");
                    })}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-2 py-1.5 text-xs normal-case tracking-normal text-slate-100"
                  >
                    <option value="general">General</option>
                    <option value="technology">Technology</option>
                    <option value="science">Science</option>
                    <option value="business">Business</option>
                  </select>
                </label>
              </div>
              {dataError && (
                <div role="status" className="rounded-lg border border-amber-400/20 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-200/90">
                  {dataError}
                </div>
              )}
              {/* Detailed Weather Card */}
              {weather ? (
                <div className="rounded-2xl p-3.5 bg-gradient-to-br from-cyan-950/40 via-slate-900/60 to-black/60 border border-cyan-500/20 shadow-inner space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-bold text-white tracking-wide flex items-center gap-1.5">
                        <MapPin size={13} className="text-cyan-400" />
                        {weather.city}
                        {weather.country && (
                          <span className="text-[10px] font-mono text-slate-400 font-normal">
                            ({weather.country})
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-cyan-300 font-medium">
                        {weather.weatherDescription}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-2xl font-bold font-mono text-white tracking-tighter">
                        {weather.temperature}
                        {weather.temperatureUnit}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400">
                        Feels {weather.apparentTemperature}
                        {weather.temperatureUnit}
                      </div>
                    </div>
                  </div>

                  {/* 4-Box Telemetry Grid */}
                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-white/5 font-mono text-[10px]">
                    <div className="p-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                      <div className="text-slate-400 flex items-center justify-center gap-1">
                        <Droplets size={10} className="text-cyan-400" /> Humidity
                      </div>
                      <div className="font-semibold text-white mt-0.5">{weather.humidity}%</div>
                    </div>

                    <div className="p-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                      <div className="text-slate-400 flex items-center justify-center gap-1">
                        <Wind size={10} className="text-teal-400" /> Wind
                      </div>
                      <div className="font-semibold text-white mt-0.5">{weather.windSpeed} km/h</div>
                    </div>

                    <div className="p-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-center">
                      <div className="text-slate-400 flex items-center justify-center gap-1">
                        <Thermometer size={10} className="text-amber-400" /> Min/Max
                      </div>
                      <div className="font-semibold text-white mt-0.5">
                        {weather.tempMin}{weather.temperatureUnit} / {weather.tempMax}{weather.temperatureUnit}
                      </div>
                    </div>
                  </div>
                </div>
              ) : city ? (
                <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-white/10 rounded-2xl">
                  <RefreshCw size={18} className={`mx-auto text-cyan-400/60 mb-2 ${isLoading ? "animate-spin" : ""}`} />
                  <div className="font-semibold text-white">{isLoading ? "Loading weather..." : "Weather unavailable"}</div>
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-white/10 rounded-2xl">
                  <MapPin size={24} className="mx-auto text-cyan-400/60 mb-2 animate-bounce" />
                  <div className="font-semibold text-white">No City Selected</div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("search")}
                    className="mt-2.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 text-xs font-semibold hover:bg-cyan-500/30 transition"
                  >
                    Select City
                  </button>
                </div>
              )}

              {/* Live News Headlines Feed */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-slate-300">
                    <Newspaper size={12} className="text-cyan-400" /> Live Headlines
                  </span>
                  <span className="text-[9px] text-white/40">
                    via {provider?.news === "newsapi" ? "NewsAPI" : "Google News"}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {news.length > 0 ? (
                    news.map((item) => (
                      <a
                        key={item.id}
                        href={item.link}
                        target="_blank"
                        rel="noreferrer"
                        className="block p-2.5 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.06] hover:border-cyan-500/30 transition group"
                      >
                        <div className="text-xs text-slate-200 group-hover:text-cyan-200 line-clamp-2 leading-snug">
                          {item.title}
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400 font-mono">
                          <span className="text-cyan-400/80 font-medium">{item.source}</span>
                          <span className="flex items-center gap-1 text-white/30 group-hover:text-white/60">
                            {item.pubDate} <ExternalLink size={9} />
                          </span>
                        </div>
                      </a>
                    ))
                  ) : (
                    <div className="py-4 text-center text-xs text-slate-500 font-mono">
                      {!city ? "Select a city to see local headlines." : isLoading ? "Fetching headlines..." : dataError ? "Headlines are currently unavailable." : "No headlines are available right now."}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer status */}
              <div className="text-[9px] font-mono text-center text-white/30 pt-1">
                {provider?.weather === "open-weather-map" || provider?.news === "newsapi" ? "Fallback Provider" : "Zero-Key Provider"}
                {" // "}
                {provider?.weather === "open-weather-map" ? "OpenWeatherMap" : "Open-Meteo"}
                {" & "}
                {provider?.news === "newsapi" ? "NewsAPI" : "Google News"}
                {lastRefreshed && ` // Updated ${lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
              </div>
            </div>
          )}
        </aside>,
        document.body,
      )}
    </div>
  );
};

export default WeatherNewsWidget;
