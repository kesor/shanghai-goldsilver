#!/usr/bin/env bash

# Fetch Silver volatility index (CVOL) data

cd "$(dirname "$0")"

OUTPUT="cvol-data.json"

# Use same cookies as fetch.sh
COOKIES='AKA_A2=A; ak_bmsc=73142335B37DF1B289DA7A4033C27035~000000000000000000000000000000~YAAQTsowFwSUXiCcAQAAQ8q2Ih5NXxBVL/bU61KK5bElJIabB8Vx0DsVI+EQv0JaguSk4/wx9RYqvWwnqWVBuZ9AqL7kOsohWASvPSWQqtODTG9itQ+Qj9lXAyeexDrJinQ9KF1yUhuSp3a9lG8l174jg3Q9CcinDT5oI8KHS8bLk5KJ3YsjKjXjpEE9Z75eDeCKmXtYyQ39wtoogwSmeVuYeaGHs8nL010GUPF+BQH+AnvFjE4uM4icyzMDl5L5q6ZTUaBHDROyM76gVMyiYW7LLU+T5aN8pcMj4wbHlV7D5adXSVpmY55n3r9D4DpPN7SHTL9dVvMx8CwCIsK7XTnGg7F11Jh7x+xh6iPglkzPZ5SxCoalo9NcynV91e9JfpZ4CWFj9UuTDrIu9tU=; bm_mi=FDB321A9B288851CECD4344580C65CB3~YAAQTsowF2vqXiCcAQAAw2m4Ih4HYm49ziQK8Kxzf/5/AQS0UZJ0b7+SouAaK26+3aBCj+HooIVWBY5YrC0m/noSSLZyUP/sdW9eceEnPy6Q2/ueViDF1fFumgmsYcQid/nrWGhUWZNw3riUoRbnuAbCvb61RkmFxswAEr+1K/JvhHqckyaMKk/+iIi42ysDCG06iHv1td2tG/yBeD3oIj5YJkVR1hb7p7V9QdswKqZWvroThf0nqMrjXxwFX4NcsePWRNZC+blU9IKqoi7aLST56KmcpnZQQyOYN7tCb26cb+ZwF3UAb2tlq+WANQLQmITwMPmmeUWeZSOxdAblyLE78cv+gWgNJRCrIuSUfDxhxxO57KWfzL+B~1; bm_sz=80E77E7F32DE00A5D35ADD174EF3FAB4~YAAQTsowF1brXiCcAQAAbW64Ih6M0KL3V9ovluo8UQAj+frT6+y8Dxz+hC3yTqXhiGjUJm5VBnaoLlS7T+W2fyOyyme5nO9yvXq0Znjuwlf3279aQpx57wF6UhWeHFoKUz4Ct40JixdTZsDZNtuVxin6MD9Rcfw1TQZebYlEatSfZzH2s+o9e7GXDCMYdlYJjtNAq3DBWyvRahBpSsUioV53LFsxpsB+YoR2DQUd/mUA4WVkUzZHGOCBA49Ng4WNiC1o5Huj/3hds9vJfpj1p2fiN5vZwlfrsy2Yy6ntn4FK9FUoxOsK0AIopHRl71Dhn3FB4fm/ydtpjHnFvBCvzvAnR5wrgUVZ8WrxOq2cagJ8OlR6s8iToh8Xa70C+2vsZv4rmCi/dxSsQ2sLzjRKrYfP9Fr75eHnJ8luYgKQCHw3L0aBPaSOMX/QvuMzGukhG98VrvhQU3HZLIvElxzhw7hj11HXBRaquJ4ZlYlPQbd4qaINuwRTcDnmEp+djg9kXQ==~3158072~4601923; _abck=3AF4A163A8C2F7A2855C38600234380E~0~YAAQTsowF7jrXiCcAQAAfnC4Ig+68EOY2tYaWbRIHJ3AVGQJ96OeTS9SoJTuy7cVyv0HH1SHXbP+exG/hkiOst+xcUoWq+072+miQfU8Pq7o66dsIYG1kBCfuR0o7LIxkn63mBQ/69DJz/Lvvpg6FoIYZdufRWhlG7eY7Xcz+ZPT1FhS8WabjmexeY59mUj6NxP7FcQT8P/H4efaPdgMtQtHvU7IW9XurjnjNemFkMBEQQt/vmrZDDvsn7EAImDnPOhK0URAnW24a2wep4aJCu4+GEhWPLv7PTr1KQXXopq8m+fZMRG/fE06wNIhLbN4o7s7LB5MpwWG/NFONc9ZBbOmFKBBC1rc9UsY7iwX9vgMK6sWzecE0NrS5V+BzluG1U0EqF9f5K6fYttdl6cwJIv1I43EUFZerXSyXH+yWshfojRVqLyyZYK+/gw3O8ipDAH8JA0jjdbX7KGSULmSjIv/hjDw5iQdQITcibsAyStTFlBPA7rKUC9/gPp0GLpMACjKp63Aun7/04eQ/OrczpBF1Ctys7pbwf/1m+8UNFFqFG80pUBEfd3SkxylUpfJI8WLCgx2DEmPpJLNOhPX0Vn6gl1JXJbNgt/oM0/2q9tOC1uaVsapk0OS+bGQoYWfEOc5cYW1KufNOlhtcEEZpl4qVUhfRzrCVWYm4k/FQfTgjxg2mAojnvi5LTAZqRyi0odaScvG94vBmp9nrMODIljme4chCQzKvsF19/PnzkqIjmXQYo8O13Uq5s3+D8pR27AXmwlN+I4wN32SeGqYPs26dvEbfLPDsliYHT/iHVj1Ogr6CpUJ3+10cWahtLlJw88+yIWCmSnp4pyq4QDvx+sQigQxWpJm/VgFyEYfaTqeqgG5+cw0SkyPtAiEEmkeB+Lme+bEy+sECJ5ouAi6M8//Yz3mSibbnZtr4XQqO8cNrPJ5eVSQ+g68iMRZcpxguEoEMjOVNxRqRr8z/hthMpBOML0KJ9qw/5gSzdEz/GbHkuwCpK4=~-1~-1~-1~AAQAAAAF%2f%2f%2f%2f%2f9XhRJAC3myfbOWAA4ToFBU9gyUvGXJ1PpNRXe3ytQc02jZrb0GgiE9tdbDCkS+hf9k%2fbOvEovkKWVin7JzLkT+kFDoUDDhCU1EpVT%2fYGELrukiWLZWWfvQa5PVIJbJFvcXMEqs%3d~-1; bm_sv=CF36FC9F83DAFE30735AD6A5C063E290~YAAQTsowFz3uXiCcAQAA6X24Ih5GFBz0MH4xyqwVKbdaedM9Bl5baBgXPunt77oL2XTJzCQsPfhKKij/MPjLo11PFgW2CSzdtohgrZCmfsj3S0Afaq5QTosaBaxdtk8cxafhHzaKTSQYuUj+2SoWWGsFHYBw9tj6ROd//edaSTvGCjkpnlywNqvljGu1yFWzkNNXVPLly7NoGw9ukJ7A9mHjLrLSmYfta+Px/l8Dv+sC9QvdMdUJXL4Yoj9mPj3mNQDI~1'

TIMESTAMP=$(date +%s)000

curl -s "https://www.cmegroup.com/services/cvol?symbol=SIVL&isProtected&_t=${TIMESTAMP}" \
  -H 'accept: application/json, text/plain, */*' \
  -H 'accept-language: en-US,en;q=0.6' \
  -H 'cache-control: no-cache' \
  -b "$COOKIES" \
  -H 'dnt: 1' \
  -H 'pragma: no-cache' \
  -H 'referer: https://www.cmegroup.com/markets/metals/precious/silver.html' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-origin' \
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36' \
  | jq '.' > "$OUTPUT"

if [ -s "$OUTPUT" ]; then
  echo "Fetched CVOL data to $OUTPUT"
else
  echo "Failed to fetch CVOL data"
  rm -f "$OUTPUT"
  exit 1
fi
