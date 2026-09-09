import math
import random

def fuzz_coordinates(lat, lon, radius_m):
    EARTH_RADIUS_M = 6371000.0

    u = random.random() # random distance
    v = random.random() # random direction
    
    # generate random distance, direction 
    d = u*radius_m
    theta = v * 2.0 * math.pi 

    # conversion and calculation in radians 
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    delta = d / EARTH_RADIUS_M

    new_lat_rad = math.asin(
        math.sin(lat_rad) * math.cos(delta) + 
        math.cos(lat_rad) * math.sin(delta) * math.cos(theta)
    )

    new_lon_rad = lon_rad + math.atan2(
        math.sin(theta) * math.sin(delta) * math.cos(lat_rad), 
        math.cos(delta) - math.sin(lat_rad) * math.sin(new_lat_rad)
    )

    # conversion to degrees
    return (math.degrees(new_lat_rad), math.degrees(new_lon_rad))

# --- Example Usage ---
# Fuzzing a point somewhere in New York City (between 100m and 500m away)
original_lat, original_lon = 40.7128, -74.0060
fuzzed_lat, fuzzed_lon = fuzz_coordinates(original_lat, original_lon, 500)

print(f"Original: {original_lat}, {original_lon}")
print(f"Fuzzed:   {fuzzed_lat:.6f}, {fuzzed_lon:.6f}")