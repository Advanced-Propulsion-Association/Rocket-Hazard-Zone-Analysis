# Weather Data Sources for Rocket Hazard Zone Calculator
## Upper-Atmosphere Wind Profile Reference

*Last researched: 2026-04-21*

---

## Summary: Recommended Sources

| Use Case | Recommended Source | CORS-Friendly | Notes |
|---|---|---|---|
| Historical winds for FAA waiver planning | **Open-Meteo Archive API** | Yes, fully | ERA5 reanalysis, 1940–present, pressure levels |
| Day-of launch forecast winds | **Open-Meteo Forecast API** | Yes, fully | Full pressure-level profile, free |
| Historical radiosonde truth data | **NOAA IGRA** | No (HTTPS FTP) | Requires backend/proxy; best for validation |
| Climatological wind rose statistics | **Open-Meteo + custom stats** | Yes | Pull multi-year data, compute stats client-side |
| Near-real-time official forecast | **AWC Winds Aloft (FD)** | Yes (plain text) | 3000–39000 ft only, no JSON decode needed |

---

## 1. NOAA IGRA — Integrated Global Radiosonde Archive

### What It Is
The definitive US/global repository of actual radiosonde (weather balloon) soundings. Version 2.2 (current as of 2025) contains over 2,800 stations worldwide, with near-real-time updates from ~800 active stations. Data extends back to 1905 for some stations. This is **ground truth** upper-air observation data, unlike model/reanalysis data.

**Official page:** https://www.ncei.noaa.gov/products/weather-balloon/integrated-global-radiosonde-archive

### Data Access — File Download (No REST API)
IGRA does **not** have a JSON/REST query API. Data is distributed as flat text files, one file per station, organized in directories. Access is via HTTPS or legacy FTP.

```
Base URL: https://www.ncei.noaa.gov/data/integrated-global-radiosonde-archive/access/

Directories:
  data-por/    -- full period of record, one .txt.zip per station
  data-y2d/    -- current + previous year only (faster download)
  derived-por/ -- derived stability/humidity parameters
  monthly-por/ -- monthly climatological means
  monthly-upd/ -- last month's means
```

**Example — Download soundings for Daytona Beach (near KSC), station USM00072214:**
```
https://www.ncei.noaa.gov/data/integrated-global-radiosonde-archive/access/data-y2d/USM00072214-data.txt.zip
```

**Station list:**
```
https://www.ncei.noaa.gov/data/integrated-global-radiosonde-archive/doc/igra2-station-list.txt
```
Format: `StationID  Lat  Lon  Elevation  Name  YearStart  YearEnd  SoundingCount`

### US Station Coverage
IGRA has approximately 90–100 NWS-managed upper-air stations in the continental US, typically spaced 200–400 miles apart. Every NWS office with an upper-air program launches balloons twice daily at 00Z and 12Z UTC. Major launch-site-relevant stations include:

| Station | Location | IGRA ID |
|---|---|---|
| Cape Canaveral / Daytona Beach area | Daytona Beach, FL | USM00072214 |
| Black Rock Desert area | Elko, NV | USM00072582 |
| Mojave/EAFB area | Vandenberg, CA | USM00072393 |
| Spaceport America area | Albuquerque, NM | USM00072365 |
| Amarillo TX (ORSC area) | Amarillo, TX | USM00072363 |

Nearest station is typically within 50–200 miles of any US launch site. For the 200-mile upper-air winds used in FAA analysis, this precision is acceptable.

### File Format — Sounding Data
Each sounding file consists of header records followed by data level records.

**Header record (fixed-width):**
```
#USM00072214 2024 01 01 00 -9999    1  ncdc-gts   125
 ^StationID  ^yr ^mo ^dy ^hr        ^nlevels  ^srcflag
```

**Data level record (fixed-width):**
```
 1  -9999     1460  -9999  -9999   2700     90
 ^leveltype ^pressure ^geopotht ^temp ^dewpt ^winddir ^windspd
```

Fields:
- **LVLTYP**: Level type (1=standard, 2=significant, 3=wind, 9=surface)
- **PRESS**: Pressure in Pa (divide by 100 for hPa); -9999 = missing
- **ZREP**: Geopotential height in meters
- **TEMP**: Temperature in tenths of °C (e.g., 146 = 14.6°C)
- **RH**: Relative humidity in tenths of %
- **DPDP**: Dewpoint depression in tenths of °C
- **WDIR**: Wind direction in degrees true (0–360)
- **WSPD**: Wind speed in tenths of m/s (e.g., 90 = 9.0 m/s)

**Full format doc:**
```
https://www.ncei.noaa.gov/data/integrated-global-radiosonde-archive/doc/igra2-data-format.txt
```

### CORS / Browser Access
**CORS: NOT available for direct browser requests.** NCEI does not set Access-Control-Allow-Origin headers on their data download servers. You must use a **backend proxy** or **server-side function** to fetch IGRA files. AWS Lambda, Vercel edge functions, or a Node/Express proxy all work.

---

## 2. University of Wyoming Radiosonde Archive

### What It Is
A widely-used mirror/query interface for upper-air soundings maintained by UWyo Atmospheric Science. Data mirrors the NWS/NOAA radiosonde observations but provides a more convenient HTML/text query interface.

**URL:** http://weather.uwyo.edu/upperair/sounding.shtml

### Programmatic Query — Text Output
While not a formal REST API, UWyo soundings can be fetched as structured text or CSV via URL parameter manipulation.

**URL pattern:**
```
http://weather.uwyo.edu/cgi-bin/bufrraob.py?TYPE=TEXT%3ALIST&YEAR={year}&MONTH={month}&FROM={day}{hour}&TO={day}{hour}&STNM={station_number}
```

**Example — Daytona Beach (WMO 72214), 2024-04-15 12Z:**
```
http://weather.uwyo.edu/cgi-bin/bufrraob.py?TYPE=TEXT%3ALIST&YEAR=2024&MONTH=04&FROM=1512&TO=1512&STNM=72214
```

**CSV output (easier to parse):**
```
http://weather.uwyo.edu/cgi-bin/bufrraob.py?TYPE=CSV&YEAR=2024&MONTH=04&FROM=1512&TO=1512&STNM=72214
```

**Returned columns (CSV):**
```
PRES, HGHT, TEMP, DWPT, RELH, MIXR, DRCT, SKNT, THTA, THTE, THTV
hPa,  m,    °C,   °C,   %,    g/kg, deg,  knot, K,    K,    K
```

Note: As of 2024, the UWyo interface reports wind speeds in **m/s** for the new interface; "Aviation Units" option restores knots.

### CORS / Browser Access
**CORS: NOT available.** UWyo does not serve CORS headers. Requires backend proxy. Additionally, the UWyo service sometimes returns 503 errors under load — it is a research server, not a production-grade API.

---

## 3. NOAA Aviation Weather Center (AWC) — Winds Aloft (FD)

### What It Is
The official NOAA Aviation Weather Center issues **Winds Aloft Forecasts** (product code FD / FB) covering fixed altitude levels from 3,000 ft MSL to FL390 (39,000 ft). These are **forecasts** for the next 6, 12, or 24 hours, issued 4× per day.

**AWC Data API:** https://aviationweather.gov/api/data/windtemp
**OpenAPI schema:** https://aviationweather.gov/data/schema/openapi.yaml

### API Endpoint

```
GET https://aviationweather.gov/api/data/windtemp
```

**Parameters:**
- `region` — `us` (CONUS), `alaska`, `hawaii`, `pacific`, `other` (default: all)
- `level` — `low` (3000–12000 ft), `high` (18000–45000 ft)  
- `fcst` — forecast hour: `06`, `12`, or `24`

**Example — US low-level winds, 6-hour forecast:**
```
https://aviationweather.gov/api/data/windtemp?region=us&level=low&fcst=06
```

**Example — US high-level winds, 12-hour forecast:**
```
https://aviationweather.gov/api/data/windtemp?region=us&level=high&fcst=12
```

### Returned Data Format
The endpoint returns a raw **ICAO FD text product** — it is **NOT JSON**. The format is the traditional coded text used for aviation. Example:

```
FBUS31 KWNO 211359
FD1US1
DATA BASED ON 211200Z
VALID 211800Z   FOR USE 1400-2100Z. TEMPS NEG ABV 24000
FT  3000    6000    9000   12000   18000   24000  30000  34000  39000
ABI      2221+09 2710+09 2913+02 2813-13 2919-26 294240 286248 275355
ACK 0309 3012-10 3217-12 3231-15 3144-26 3257-37 325746 315349 313951
```

**Decoding the coded format:**
Each station entry has a 4-digit wind group, sometimes followed by temperature:
```
2913+02  =>  direction=290°, speed=13 knots, temperature=+02°C
2813-13  =>  direction=280°, speed=13 knots, temperature=-13°C
294240   =>  direction=290°, speed=42 knots, temperature=-40°C (implicit negative above 24000 ft)
```
- First 2 digits: wind direction / 10 (e.g., 29 → 290°)
- Next 2 digits: wind speed in **knots**
- Next 3 chars: temperature with sign (°C)
- `9900` = calm/light and variable
- Speed ≥ 100 knots: subtract 50 from first pair and add 100 to speed (e.g., `731540` = dir 230°, speed 115 kt, temp -40°C)

**Altitude levels covered:**
- `low`: 3,000, 6,000, 9,000, 12,000 ft MSL (no temperature at 3,000)
- `high`: 18,000, 24,000, 30,000, 34,000, 39,000 ft MSL (and optionally 45,000 ft)

**Coverage: 3,000–39,000 ft MSL (~30,500 ft = ~FL390 = top of this product for rockets)**

### Altitude Gap
The FD product does **not** cover above FL390 (~40,000 ft / ~12,200 m). For rockets going above this, reanalysis data (ERA5 / Open-Meteo) is needed.

### CORS / Browser Access
**CORS: Available.** The AWC API appears to serve without CORS restrictions and returns plain text. This endpoint can be called directly from a browser/React app. No authentication required.

**Limitation:** This is a current forecast product only — no historical archive access through this endpoint. For historical FD data, NOAA archives are available but require custom parsing.

---

## 4. Open-Meteo — Historical Archive API (ERA5 Backed)

### What It Is
Open-Meteo is a free, open-source weather API that provides a clean REST/JSON interface backed by ECMWF ERA5 reanalysis data and other models. For historical wind profiles (waiver planning), this is the **single best source for a no-backend web app**.

**Website:** https://open-meteo.com  
**License:** Free for non-commercial use; CC BY 4.0  
**Data coverage:** 1940 to present (ERA5 goes back to 1940; higher-res models from 2017+)

### Historical Wind Profile API

**Base URL:**
```
https://archive-api.open-meteo.com/v1/archive
```

**Key parameters:**
- `latitude`, `longitude` — decimal degrees WGS84
- `start_date`, `end_date` — YYYY-MM-DD format
- `hourly` — comma-separated list of variables (see below)
- `wind_speed_unit` — `ms` (m/s), `mph`, `kn`, `kmh` (default: `kmh`)
- `models` — optionally specify `era5`, `era5_land`, `cerra`, etc.

**Wind variables at pressure levels:**

| Variable Pattern | Approx Altitude |
|---|---|
| `wind_speed_1000hPa` / `wind_direction_1000hPa` | ~330 ft / 100 m |
| `wind_speed_925hPa` / `wind_direction_925hPa` | ~2,500 ft / 762 m |
| `wind_speed_850hPa` / `wind_direction_850hPa` | ~4,900 ft / 1,500 m |
| `wind_speed_700hPa` / `wind_direction_700hPa` | ~10,000 ft / 3,000 m |
| `wind_speed_600hPa` / `wind_direction_600hPa` | ~13,800 ft / 4,200 m |
| `wind_speed_500hPa` / `wind_direction_500hPa` | ~18,300 ft / 5,600 m |
| `wind_speed_400hPa` / `wind_direction_400hPa` | ~23,600 ft / 7,200 m |
| `wind_speed_300hPa` / `wind_direction_300hPa` | ~30,100 ft / 9,200 m |
| `wind_speed_250hPa` / `wind_direction_250hPa` | ~34,100 ft / 10,400 m |
| `wind_speed_200hPa` / `wind_direction_200hPa` | ~38,600 ft / 11,800 m |
| `wind_speed_150hPa` / `wind_direction_150hPa` | ~44,400 ft / 13,500 m |
| `wind_speed_100hPa` / `wind_direction_100hPa` | ~53,500 ft / 16,200 m |
| `wind_speed_70hPa` / `wind_direction_70hPa` | ~59,000 ft / 18,000 m |
| `wind_speed_50hPa` / `wind_direction_50hPa` | ~66,700 ft / 20,300 m |
| `wind_speed_30hPa` / `wind_direction_30hPa` | ~77,800 ft / 23,700 m |

Also available: `geopotential_height_{level}hPa` — precise altitude in meters for that pressure level at that location/time.

**Also available at fixed heights above ground:**
- `wind_speed_10m`, `wind_direction_10m` — standard surface wind
- `wind_speed_80m`, `wind_direction_80m`
- `wind_speed_100m`, `wind_direction_100m` (Historical API only)
- `wind_speed_120m`, `wind_direction_120m`
- `wind_speed_180m`, `wind_direction_180m`

**Example — Full wind profile for KSC area, April 2024:**
```
https://archive-api.open-meteo.com/v1/archive
  ?latitude=28.5
  &longitude=-80.65
  &start_date=2024-04-01
  &end_date=2024-04-30
  &hourly=wind_speed_1000hPa,wind_direction_1000hPa,
          wind_speed_925hPa,wind_direction_925hPa,
          wind_speed_850hPa,wind_direction_850hPa,
          wind_speed_700hPa,wind_direction_700hPa,
          wind_speed_500hPa,wind_direction_500hPa,
          wind_speed_300hPa,wind_direction_300hPa,
          wind_speed_200hPa,wind_direction_200hPa,
          wind_speed_100hPa,wind_direction_100hPa,
          geopotential_height_1000hPa,geopotential_height_925hPa,
          geopotential_height_850hPa,geopotential_height_700hPa,
          geopotential_height_500hPa,geopotential_height_300hPa,
          geopotential_height_200hPa,geopotential_height_100hPa
  &wind_speed_unit=ms
  &models=era5
```

(URL-encode the commas or just list them separately in a fetch call.)

**Verified working example response (condensed):**
```json
{
  "latitude": 28.50615,
  "longitude": -80.68262,
  "elevation": 3.0,
  "hourly_units": {
    "time": "iso8601",
    "wind_speed_10m": "m/s",
    "wind_direction_10m": "°"
  },
  "hourly": {
    "time": ["2024-04-01T00:00", "2024-04-01T01:00", ...],
    "wind_speed_10m": [3.32, 4.57, ...],
    "wind_direction_10m": [134, 157, ...],
    "wind_speed_100m": [5.45, 7.98, ...],
    "wind_direction_100m": [137, 158, ...]
  }
}
```

### CORS / Browser Access
**CORS: Fully available.** Open-Meteo explicitly supports browser requests. No API key required for non-commercial use. Rate limits are generous (10,000 requests/day on free tier).

**This is the recommended primary source for the hazard zone calculator.**

---

## 5. Open-Meteo — Forecast API (Pressure Level Winds)

For **day-of-launch forecast** winds, the standard Open-Meteo forecast API provides the same pressure-level variables, backed by ECMWF IFS and/or GFS.

**Base URL:**
```
https://api.open-meteo.com/v1/forecast
```

**Same `hourly` variables as the Archive API**, plus up to 16-day lookahead.

**Verified working example — KSC area, full pressure-level profile today:**
```
https://api.open-meteo.com/v1/forecast
  ?latitude=28.5
  &longitude=-80.65
  &hourly=wind_speed_1000hPa,wind_direction_1000hPa,
          wind_speed_850hPa,wind_direction_850hPa,
          wind_speed_700hPa,wind_direction_700hPa,
          wind_speed_500hPa,wind_direction_500hPa,
          wind_speed_300hPa,wind_direction_300hPa,
          wind_speed_200hPa,wind_direction_200hPa,
          geopotential_height_1000hPa,geopotential_height_850hPa,
          geopotential_height_700hPa,geopotential_height_500hPa,
          geopotential_height_300hPa,geopotential_height_200hPa
  &forecast_days=3
```

**CORS: Fully available.** No key required.

---

## 6. ERA5 via Copernicus CDS (Direct Access)

### What It Is
The authoritative ERA5 dataset is published by ECMWF through the Copernicus Climate Data Store (CDS). It covers 1940 to present at 0.25° horizontal resolution, hourly, with 37 pressure levels from 1000 hPa to 1 hPa.

**CDS Dataset:** https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels  
**DOI:** 10.24381/cds.bd0915c6

### Key Specs
- **Horizontal resolution:** 0.25° × 0.25° (~28 km)
- **Vertical levels:** 37 pressure levels: 1000, 975, 950, 925, 900, 850, 800, 750, 700, 650, 600, 550, 500, 450, 400, 350, 300, 250, 200, 150, 100, 70, 50, 30, 20, 10, 7, 5, 3, 2, 1 hPa
- **Temporal:** Hourly, updated daily with ~5-day lag
- **Variables include:** `u` (eastward wind, m/s), `v` (northward wind, m/s), `z` (geopotential, m²/s²), `t` (temperature, K), `r` (relative humidity, %)

### Python Access via CDS API
Requires free ECMWF account + API key. Install: `pip install cdsapi`

```python
import cdsapi
c = cdsapi.Client()

c.retrieve('reanalysis-era5-pressure-levels', {
    'product_type': 'reanalysis',
    'variable': ['u_component_of_wind', 'v_component_of_wind', 'geopotential'],
    'pressure_level': ['1000', '925', '850', '700', '500', '300', '200', '100', '50'],
    'year': '2024',
    'month': '04',
    'day': ['01', '02', '03'],
    'time': ['00:00', '06:00', '12:00', '18:00'],
    'area': [32, -85, 24, -75],  # North, West, South, East (KSC bounding box)
    'format': 'netcdf',
}, 'ksc_winds_april2024.nc')
```

### Unit Conversions for ERA5
- `u` / `v` components (m/s) → convert to speed/direction:
  - `speed = sqrt(u² + v²)`
  - `dir = atan2(-u, -v) * 180/π` (meteorological convention, direction wind is FROM)
- `geopotential z` (m²/s²) → height in meters: `height_m = z / 9.80665`

### CORS / Browser Access
**NOT CORS-friendly.** The CDS API requires authentication and Python/server-side access. This is a data-science/backend tool. **Use Open-Meteo instead for browser-based access** — Open-Meteo's historical API is itself backed by ERA5 data and provides a CORS-friendly JSON wrapper around the same underlying data.

---

## 7. NOAA AWS Open Data — RAP and GFS

### NOAA Rapid Refresh (RAP) on AWS S3

**Registry page:** https://registry.opendata.aws/noaa-rap/  
**S3 Bucket:** `s3://noaa-rap-pds` (us-east-1, no auth required)  
**Browse:** https://noaa-rap-pds.s3.amazonaws.com/index.html

RAP is NOAA's hourly-updated, short-range NWP model covering North America at 13 km horizontal resolution with 50 vertical levels. Runs hourly; 21-hour forecasts for most cycles, 51-hour for 03/09/15/21Z cycles.

**File naming:** `{yyyymmdd}/{hh}z/rap.t{hh}z.awp13f{ff}.grib2`  
Where `hh` = cycle hour, `ff` = forecast hour offset

**Access via AWS CLI (no account needed):**
```bash
aws s3 ls --no-sign-request s3://noaa-rap-pds/20240401/
aws s3 cp --no-sign-request s3://noaa-rap-pds/20240401/12z/rap.t12z.awp13f00.grib2 .
```

**Format:** GRIB2. Requires `wgrib2`, `cfgrib`, or similar library to extract. Not trivially browser-accessible.

### NOAA GFS on AWS S3

**Registry page:** https://registry.opendata.aws/noaa-gfs-bdp-pds/  
**S3 Bucket:** `s3://noaa-gfs-bdp-pds`  
**Update frequency:** 4× daily (00Z, 06Z, 12Z, 18Z), 16-day forecasts

GFS is the global medium-range model at 0.25° resolution, 64+ vertical levels. Covers surface through upper stratosphere.

**CORS / Browser Access:** S3 GRIB2 files are **not** browser-accessible in a useful way without a backend. These require GRIB2 parsing (Python `cfgrib`, Node `grib2`, or wgrib2 binaries). Not suitable for direct web app consumption without a preprocessing backend.

**Best used for:** Server-side data pipeline to pre-extract and cache wind profiles for the hazard zone calculator.

---

## 8. NOAA CDO — Climate Data Online API

### What It Is
NOAA's Climate Data Online (CDO) API provides historical climate observations. It covers surface weather stations but **does NOT provide upper-air wind profiles**. It is relevant only for **surface wind** climatology (wind rose stats for near-surface).

**API Base:** `https://www.ncei.noaa.gov/cdo-web/api/v2/`  
**Documentation:** https://www.ncei.noaa.gov/cdo-web/webservices/v2  
**Authentication:** Free API token (register at https://www.ncdc.noaa.gov/cdo-web/token)

**Example — Daily wind observations for KSC area:**
```
GET https://www.ncei.noaa.gov/cdo-web/api/v2/data
  ?datasetid=GHCND
  &stationid=GHCND:USW00092809
  &datatypeid=AWND,AWND_ATTRIBUTES
  &startdate=2023-04-01
  &enddate=2023-04-30
  &units=metric
  &limit=100
Headers: token: {your_token}
```

**CORS / Browser Access:** The CDO API requires an authentication token (free). CORS is available with the token in the Authorization header. However, embedding an API token in client-side code is a security concern — use a backend proxy.

**Recommendation:** For wind rose statistics at the surface, CDO is useful. For upper-air wind roses (all altitudes relevant to rockets), use the Open-Meteo archive to pull multi-year data and compute statistics yourself.

---

## 9. Practical Implementation Guide

### For a React/TypeScript Web App (No Backend)

**Fully usable directly in browser:**

| Source | Endpoint | Data | Notes |
|---|---|---|---|
| Open-Meteo Forecast | `api.open-meteo.com/v1/forecast` | Full pressure-level wind profile, now through +16 days | CORS OK, free, no key |
| Open-Meteo Archive | `archive-api.open-meteo.com/v1/archive` | Historical wind by lat/lon, 1940–present | CORS OK, free, no key |
| AWC Winds Aloft | `aviationweather.gov/api/data/windtemp` | Current FD text product, 3000–39000 ft | CORS OK, no key; text needs custom parser |

**Requires backend proxy (server-side function, e.g., Vercel/Netlify):**

| Source | Why Proxy Needed |
|---|---|
| NOAA IGRA files | No CORS headers on NCEI download server |
| UWyo soundings | No CORS headers |
| ERA5 CDS API | Authentication + Python dependency |
| NOAA AWS GRIB2 | Binary format, requires native parsing libraries |

### Recommended Architecture for Hazard Zone Calculator

**Feature 1: Historical Wind Profile Lookup**
```
User provides: lat, lon, target date (or date range for climatology)

1. Query Open-Meteo Archive API with lat/lon and date range
2. Request all pressure levels from 1000hPa down to 30hPa
3. Include geopotential_height at each level
4. Convert wind speed unit from km/h to m/s (divide by 3.6) or request ms directly
5. Build wind profile array: [{altitudeMSL_m, speedMs, directionDeg}, ...]
   Using geopotential_height values as the altitude for each level
6. Optionally interpolate to rocket-sim altitude steps (e.g., every 1000 ft)
```

**Feature 2: Launch Azimuth Optimization**
```
1. Pull 5–10 years of historical April/May/June data (whichever launch month applies)
   for the launch site using Open-Meteo Archive API
2. For each historical sounding:
   a. Run trajectory simulation with winds at various azimuths
   b. Compute debris footprint extent
3. Build wind rose of upper-air effective winds by altitude layer
4. Find azimuth that minimizes: max(downrange at each altitude)
5. Weight by probability (more recent years, similar wind regimes)
```

**Feature 3: Day-of Launch**
```
1. Query Open-Meteo Forecast API for today + 3 days
2. Allow user to pick launch time slot
3. Show wind profile for chosen time
4. Re-run azimuth optimization with actual forecast winds
```

### TypeScript Example — Open-Meteo Wind Profile Fetch

```typescript
interface WindLevel {
  pressureHPa: number;
  altitudeM: number;  // from geopotential height
  speedMs: number;
  directionDeg: number;
}

const PRESSURE_LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30];

async function fetchWindProfile(
  lat: number,
  lon: number,
  date: string  // YYYY-MM-DD
): Promise<WindLevel[]> {
  const hourly = PRESSURE_LEVELS.flatMap(p => [
    `wind_speed_${p}hPa`,
    `wind_direction_${p}hPa`,
    `geopotential_height_${p}hPa`,
  ]).join(',');

  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', lat.toString());
  url.searchParams.set('longitude', lon.toString());
  url.searchParams.set('start_date', date);
  url.searchParams.set('end_date', date);
  url.searchParams.set('hourly', hourly);
  url.searchParams.set('wind_speed_unit', 'ms');

  const res = await fetch(url.toString());
  const data = await res.json();

  // Extract 12Z sounding (index 12 for the 12:00 entry)
  const idx = 12;
  return PRESSURE_LEVELS.map(p => ({
    pressureHPa: p,
    altitudeM: data.hourly[`geopotential_height_${p}hPa`][idx],
    speedMs: data.hourly[`wind_speed_${p}hPa`][idx],
    directionDeg: data.hourly[`wind_direction_${p}hPa`][idx],
  })).filter(l => l.altitudeM != null);
}
```

### Altitude Coverage Comparison

| Source | Min Alt | Max Alt | Altitude Basis |
|---|---|---|---|
| Open-Meteo pressure levels | ~330 ft (1000 hPa) | ~77,800 ft (30 hPa) | Geopotential height (varies by loc) |
| AWC FD product | 3,000 ft MSL | 39,000 ft MSL | Fixed flight level |
| Open-Meteo fixed height | 10 m AGL | 180 m AGL | Fixed height above ground |
| IGRA soundings | Surface | ~100,000 ft+ | Reported geopotential height |
| ERA5 CDS (direct) | Surface (1000 hPa) | ~100,000 ft (1 hPa) | 37 levels |

For rockets going above 100,000 ft (~30 km), only ERA5 at native resolution (via CDS) or IGRA reach those altitudes. However, above ~100,000 ft, winds are generally very light and highly variable stratospheric/mesospheric winds that have minimal impact on typical sounding rocket trajectories.

---

## 10. Climatological Wind Rose Statistics

### Approach: Pull Multi-Year Data from Open-Meteo

To generate a wind rose / prevailing wind statistics for FAA waiver planning:

1. Pull all April data (or whichever month) for years 2015–2024 from the Archive API
2. Extract the 12Z sounding for each day (typically better sampled than 00Z for daytime launches)
3. For each pressure level, build a histogram of wind speed and direction
4. Express as: "For April at 30,000 ft, prevailing winds are from the west (270°) at 25–35 kt 70% of the time"
5. The optimal launch azimuth is perpendicular to the dominant drift direction for the highest-weighted altitude band

**Example URL — 10 years of April soundings at a given lat/lon:**
```
https://archive-api.open-meteo.com/v1/archive
  ?latitude=32.99
  &longitude=-106.97
  &start_date=2015-04-01
  &end_date=2024-04-30
  &hourly=wind_speed_500hPa,wind_direction_500hPa,
          wind_speed_300hPa,wind_direction_300hPa,
          wind_speed_200hPa,wind_direction_200hPa
  &wind_speed_unit=ms
```

This request returns ~3,000 hourly data points per variable — very manageable to process client-side.

### NOAA CDO for Surface Wind Rose
For surface winds specifically, NOAA CDO provides the `AWND` (Average Wind Speed) data type from ASOS/AWOS stations. However, CDO does **not** provide wind direction statistics — only daily average speed. For surface wind roses you would need ISD (Integrated Surface Database) hourly data.

---

## 11. Source Reference Summary

| Source | URL | Access | Type | CORS |
|---|---|---|---|---|
| NOAA IGRA v2.2 product page | https://www.ncei.noaa.gov/products/weather-balloon/integrated-global-radiosonde-archive | Public | Historical radiosonde archive | No |
| IGRA station list | https://www.ncei.noaa.gov/data/integrated-global-radiosonde-archive/doc/igra2-station-list.txt | Public | Text file | No |
| IGRA data files | https://www.ncei.noaa.gov/data/integrated-global-radiosonde-archive/access/ | Public | Zipped text | No |
| UWyo soundings | http://weather.uwyo.edu/upperair/sounding.shtml | Public | HTML query | No |
| AWC Winds Aloft API | https://aviationweather.gov/api/data/windtemp | Public | FD text product | Yes |
| AWC OpenAPI schema | https://aviationweather.gov/data/schema/openapi.yaml | Public | YAML | Yes |
| Open-Meteo Forecast | https://api.open-meteo.com/v1/forecast | Public | JSON REST | Yes |
| Open-Meteo Archive | https://archive-api.open-meteo.com/v1/archive | Public | JSON REST | Yes |
| Open-Meteo docs | https://open-meteo.com/en/docs | Public | Documentation | N/A |
| ERA5 CDS dataset | https://cds.climate.copernicus.eu/datasets/reanalysis-era5-pressure-levels | Free (account) | GRIB/NetCDF API | No |
| ERA5 download guide | https://confluence.ecmwf.int/display/CKB/How+to+download+ERA5 | Public | Documentation | N/A |
| NOAA RAP on AWS | https://registry.opendata.aws/noaa-rap/ | Public | S3 GRIB2 | No |
| NOAA GFS on AWS | https://registry.opendata.aws/noaa-gfs-bdp-pds/ | Public | S3 GRIB2 | No |
| NOAA CDO API | https://www.ncei.noaa.gov/cdo-web/webservices/v2 | Free token | JSON REST | Partial |

---

## Appendix A: Pressure Level to Approximate Altitude (Standard Atmosphere)

| Pressure (hPa) | Approx Altitude (ft MSL) | Approx Altitude (m MSL) |
|---|---|---|
| 1013 | 0 (sea level) | 0 |
| 1000 | 363 | 111 |
| 925 | 2,539 | 774 |
| 850 | 4,781 | 1,457 |
| 700 | 9,882 | 3,012 |
| 600 | 13,944 | 4,250 |
| 500 | 18,289 | 5,574 |
| 400 | 23,574 | 7,185 |
| 300 | 30,065 | 9,164 |
| 250 | 34,000 | 10,363 |
| 200 | 38,662 | 11,784 |
| 150 | 44,647 | 13,608 |
| 100 | 53,083 | 16,180 |
| 70 | 59,751 | 18,208 |
| 50 | 67,723 | 20,643 |
| 30 | 79,000 | 24,080 |
| 10 | 102,000 | 31,100 |

*Altitudes are approximate and vary with temperature profile. Use `geopotential_height` from the API for precise values.*

---

## Appendix B: AWC FD Product — Decoding Reference

Wind group encoding (4 or 6 characters):
```
DDSSTT  where:
  DD  = wind direction in tens of degrees (e.g., 27 = 270°)
  SS  = wind speed in knots
  TT  = temperature in °C (with explicit + or - sign below 24,000 ft)

Special cases:
  9900    = calm / variable (no usable direction)
  0000TT  = calm with temperature only
  
Speed ≥ 100 knots:
  DD is (actual_dir/10) + 50
  SS is actual_speed - 100
  Example: 7315-40 = dir 230°, speed 115 kt, temp -40°C
  Check: (73-50)*10 = 230°, 15+100 = 115 kt
  
Temperature above 24,000 ft:
  Temperature digits are ALWAYS negative (no sign shown)
  Example: "294240" at 30,000 ft = dir 290°, speed 42 kt, temp -40°C
```
