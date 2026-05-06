import json
import re
import math

def test_transform(path):
    with open(path, 'rb') as f:
        data = f.read()
    text = data.decode('latin1', errors='ignore')
    
    # Extraer GPTS/LPTS
    gpts_m = re.search(r'/GPTS\s*\[([^\]]+)\]', text)
    lpts_m = re.search(r'/LPTS\s*\[([^\]]+)\]', text)
    
    if not gpts_m or not lpts_m:
        print(f"No GPTS/LPTS en {path}")
        return
    
    gpts = [float(x) for x in gpts_m.group(1).strip().split()]
    lpts = [float(x) for x in lpts_m.group(1).strip().split()]
    
    print(f"\n{'='*60}")
    print(f"TEST TRANSFORM: {path}")
    print(f"{'='*60}")
    
    # Asignar esquinas
    corners = {}
    for i in range(4):
        lat = gpts[i*2]
        lon = gpts[i*2+1]
        nx = lpts[i*2]
        ny = lpts[i*2+1]
        
        if nx <= 0.5 and ny >= 0.5:
            corners['tl'] = [lon, lat]
        elif nx >= 0.5 and ny >= 0.5:
            corners['tr'] = [lon, lat]
        elif nx <= 0.5 and ny <= 0.5:
            corners['bl'] = [lon, lat]
        elif nx >= 0.5 and ny <= 0.5:
            corners['br'] = [lon, lat]
    
    # Simular transformación PSAD56GEO -> WGS84
    # towgs84=289,164,-377
    dx, dy, dz = 289, 164, -377
    a1 = 6378388.0
    f1 = 1/297.0
    e1_sq = 2*f1 - f1**2
    
    def transform_point(lon, lat):
        lat_rad = math.radians(lat)
        lon_rad = math.radians(lon)
        M = a1 * (1 - e1_sq) / (1 - e1_sq * math.sin(lat_rad)**2)**1.5
        N = a1 / math.sqrt(1 - e1_sq * math.sin(lat_rad)**2)
        
        dlat_m = (dx * math.sin(lat_rad) * math.cos(lon_rad) + 
                  dy * math.sin(lat_rad) * math.sin(lon_rad) - 
                  dz * math.cos(lat_rad))
        dlon_m = (-dx * math.sin(lon_rad) + dy * math.cos(lon_rad))
        
        dlat_deg = dlat_m / M * (180/math.pi)
        dlon_deg = dlon_m / (N * math.cos(lat_rad)) * (180/math.pi)
        
        return lon + dlon_deg, lat + dlat_deg
    
    print("\nAntes (PSAD56):")
    for k, v in corners.items():
        print(f"  {k}: {v[1]:.8f}, {v[0]:.8f}")
    
    print("\nDespues (WGS84):")
    for k, v in corners.items():
        new_lon, new_lat = transform_point(v[0], v[1])
        print(f"  {k}: {new_lat:.8f}, {new_lon:.8f}")
    
    # Calcular desfase en metros en el centro
    center_lat = sum(corners[k][1] for k in corners) / 4
    center_lon = sum(corners[k][0] for k in corners) / 4
    new_center_lon, new_center_lat = transform_point(center_lon, center_lat)
    
    dlat_m = (new_center_lat - center_lat) * 111000
    dlon_m = (new_center_lon - center_lon) * 111000 * math.cos(math.radians(center_lat))
    
    print(f"\nDesfase en centro del mapa:")
    print(f"  N/S: {dlat_m:.1f} metros")
    print(f"  E/W: {dlon_m:.1f} metros")
    print(f"  Total: {math.sqrt(dlat_m**2 + dlon_m**2):.1f} metros")

test_transform(r'C:\Users\LojanoE\Documents\GitHub\MAPS_GIS\IGNORAR\DRQ_PDF.pdf')
test_transform(r'C:\Users\LojanoE\Documents\GitHub\MAPS_GIS\IGNORAR\DRT_PDF.pdf')
