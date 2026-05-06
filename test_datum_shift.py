import math

# Simulacion de transformacion de datum PSAD56 -> WGS84
# Usando aproximacion Molodensky simplificada

def molodensky(lat, lon, a1, f1, a2, f2, dx, dy, dz):
    """
    Transformacion simplificada de datum.
    lat, lon en grados decimales
    a1, f1: semieje mayor y aplanamiento del datum origen
    a2, f2: semieje mayor y aplanamiento del datum destino  
    dx, dy, dz: parametros de transformacion (metros)
    """
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    
    # PSAD56 usa ellipsoide International 1924
    # WGS84 usa ellipsoide WGS84
    a1 = 6378388.0  # International 1924
    f1 = 1/297.0
    a2 = 6378137.0  # WGS84
    f2 = 1/298.257223563
    
    e1_sq = 2*f1 - f1**2
    e2_sq = 2*f2 - f2**2
    
    # Radio de curvatura en el meridiano
    M = a1 * (1 - e1_sq) / (1 - e1_sq * math.sin(lat_rad)**2)**1.5
    # Radio de curvatura en el primer vertical
    N = a1 / math.sqrt(1 - e1_sq * math.sin(lat_rad)**2)
    
    dlat = (-dx * math.sin(lat_rad) * math.cos(lon_rad) -
            dy * math.sin(lat_rad) * math.sin(lon_rad) +
            dz * math.cos(lat_rad) +
            (a2 * f2 - a1 * f1) * (2 * math.sin(lat_rad) * math.cos(lat_rad)) / math.sin(lat_rad) +
            (f1 * a1 - f2 * a2) * (2 * math.sin(lat_rad) * math.cos(lat_rad))) / (M + 0)
    
    # Simplificacion: solo usamos dx, dy, dz directamente
    # En latitudes ecuatoriales, el efecto principal es:
    dlat_approx = (dx * math.sin(lat_rad) * math.cos(lon_rad) + 
                   dy * math.sin(lat_rad) * math.sin(lon_rad) - 
                   dz * math.cos(lat_rad)) / M
    
    dlon_approx = (-dx * math.sin(lon_rad) + dy * math.cos(lon_rad)) / (N * math.cos(lat_rad))
    
    # Valores tipicos para Ecuador con towgs84=288,175,-376:
    # dx=288, dy=175, dz=-376
    dx, dy, dz = 288, 175, -376
    
    dlat_m = (dx * math.sin(lat_rad) * math.cos(lon_rad) + 
              dy * math.sin(lat_rad) * math.sin(lon_rad) - 
              dz * math.cos(lat_rad))
    
    dlon_m = (-dx * math.sin(lon_rad) + dy * math.cos(lon_rad))
    
    # Convertir desplazamientos a grados
    dlat_deg = dlat_m / M * (180/math.pi)
    dlon_deg = dlon_m / (N * math.cos(lat_rad)) * (180/math.pi)
    
    return lat + dlat_deg, lon + dlon_deg

# Punto de ejemplo del DRQ_PDF.pdf
test_points = [
    (-3.561872215670423, -78.47617607298018, "TL"),
    (-3.5749612402199116, -78.47614033497605, "BL"),
]

print("Transformacion PSAD56 -> WGS84 (aproximada)")
print("Usando towgs84=288,175,-376 (valores tipicos Ecuador)")
print()

for lat, lon, label in test_points:
    lat_wgs, lon_wgs = molodensky(lat, lon, 0, 0, 0, 0, 0, 0, 0)
    dlat = (lat_wgs - lat) * 111000  # aprox metros por grado lat
    dlon = (lon_wgs - lon) * 111000 * math.cos(math.radians(lat))  # aprox metros por grado lon
    print(f"{label}:")
    print(f"  PSAD56: {lat:.8f}, {lon:.8f}")
    print(f"  WGS84:  {lat_wgs:.8f}, {lon_wgs:.8f}")
    print(f"  Delta:  {dlat:.1f}m N/S, {dlon:.1f}m E/W")
    print()

# Veamos tambien con diferentes parametros towgs84
print("Con towgs84=289,164,-377 (usado en app.js):")
for lat, lon, label in test_points:
    dx, dy, dz = 289, 164, -377
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    a1 = 6378388.0
    f1 = 1/297.0
    e1_sq = 2*f1 - f1**2
    M = a1 * (1 - e1_sq) / (1 - e1_sq * math.sin(lat_rad)**2)**1.5
    N = a1 / math.sqrt(1 - e1_sq * math.sin(lat_rad)**2)
    
    dlat_m = (dx * math.sin(lat_rad) * math.cos(lon_rad) + 
              dy * math.sin(lat_rad) * math.sin(lon_rad) - 
              dz * math.cos(lat_rad))
    dlon_m = (-dx * math.sin(lon_rad) + dy * math.cos(lon_rad))
    
    dlat_deg = dlat_m / M * (180/math.pi)
    dlon_deg = dlon_m / (N * math.cos(lat_rad)) * (180/math.pi)
    
    lat_wgs = lat + dlat_deg
    lon_wgs = lon + dlon_deg
    dlat = dlat_m
    dlon = dlon_m
    print(f"{label}: delta {dlat:.1f}m N/S, {dlon:.1f}m E/W")
