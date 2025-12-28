# GeoLite2 Database Setup

This directory should contain the MaxMind GeoLite2-City database for IP geolocation.

## Setup Instructions

1. **Create a free MaxMind account**
   - Go to https://www.maxmind.com/en/geolite2/signup
   - Register for a free account

2. **Generate a license key**
   - Log in to your MaxMind account
   - Go to Account → Manage License Keys
   - Generate a new license key

3. **Download the database**
   - Go to Account → Download Files
   - Download "GeoLite2 City" in MMDB format
   - Extract the `.mmdb` file

4. **Place the database file**
   - Copy `GeoLite2-City.mmdb` to this directory (`backend/data/`)
   - Or set the `GEOIP_DATABASE_PATH` environment variable

## Alternative: Automatic Updates

For production, consider using MaxMind's `geoipupdate` tool:
https://github.com/maxmind/geoipupdate

## File Location

The geolocation service looks for the database in these locations (in order):
1. `GEOIP_DATABASE_PATH` environment variable
2. `backend/data/GeoLite2-City.mmdb` (this directory)
3. `/var/lib/GeoIP/GeoLite2-City.mmdb` (Linux standard)
4. `C:/ProgramData/MaxMind/GeoLite2-City.mmdb` (Windows)

## Privacy Note

The geolocation lookup happens BEFORE IP anonymization. The raw IP address
is never stored - only the country/city information and an anonymized IP.
