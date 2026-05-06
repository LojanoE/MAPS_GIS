import sys
import json
import re
import math

# Definición de proj4 para PSAD56 UTM 17S (simplificada)
# En el navegador usamos proj4js, aquí usaremos una aproximación para verificar
# Pero para entender el problema, solo necesitamos ver las coordenadas

def analyze_geopdf_logic(path):
    with open(path, 'rb') as f:
        data = f.read()
    
    text = data.decode('latin1', errors='ignore')
    
    print(f"\n{'='*60}")
    print(f"SIMULACION DE CARGA: {path}")
    print(f"{'='*60}")
    
    # Extraer GPTS y LPTS como hace el código
    gpts_all = []
    for m in re.finditer(r'/GPTS\s*\[([^\]]+)\]', text):
        vals = [float(x) for x in m.group(1).strip().split()]
        if all(not math.isnan(v) for v in vals):
            gpts_all.append(vals)
    
    lpts_all = []
    for m in re.finditer(r'/LPTS\s*\[([^\]]+)\]', text):
        vals = [float(x) for x in m.group(1).strip().split()]
        if all(not math.isnan(v) for v in vals):
            lpts_all.append(vals)
    
    if not gpts_all or not lpts_all:
        print("No se encontraron GPTS/LPTS")
        return
    
    gpts = gpts_all[0]
    lpts = lpts_all[0]
    
    print(f"\nGPTS raw: {gpts}")
    print(f"LPTS raw: {lpts}")
    
    # Simular extractISO32000
    print("\n--- Paso 1: extractISO32000 ---")
    
    tl = tr = bl = br = None
    
    for i in range(4):
        lat = gpts[i*2]
        lon = gpts[i*2+1]
        nx = lpts[i*2]
        ny = lpts[i*2+1]
        
        print(f"  Punto {i}: lat={lat}, lon={lon}, nx={nx}, ny={ny}")
        
        if nx <= 0.5 and ny >= 0.5:
            tl = {'lat': lat, 'lon': lon, 'nx': nx, 'ny': ny}
            print(f"    -> Asignado como TL")
        elif nx >= 0.5 and ny >= 0.5:
            tr = {'lat': lat, 'lon': lon, 'nx': nx, 'ny': ny}
            print(f"    -> Asignado como TR")
        elif nx <= 0.5 and ny <= 0.5:
            bl = {'lat': lat, 'lon': lon, 'nx': nx, 'ny': ny}
            print(f"    -> Asignado como BL")
        elif nx >= 0.5 and ny <= 0.5:
            br = {'lat': lat, 'lon': lon, 'nx': nx, 'ny': ny}
            print(f"    -> Asignado como BR")
    
    # Fallback si falta alguno
    if not all([tl, tr, bl, br]):
        print("\n  Usando fallback por orden ISO 32000-2:")
        tl = {'lat': gpts[0], 'lon': gpts[1]}
        tr = {'lat': gpts[2], 'lon': gpts[3]}
        br = {'lat': gpts[4], 'lon': gpts[5]}
        bl = {'lat': gpts[6], 'lon': gpts[7]}
        print(f"    TL: lat={tl['lat']}, lon={tl['lon']}")
        print(f"    TR: lat={tr['lat']}, lon={tr['lon']}")
        print(f"    BR: lat={br['lat']}, lon={br['lon']}")
        print(f"    BL: lat={bl['lat']}, lon={bl['lon']}")
    
    # El código fuerza EPSG:4326
    detected_crs = 'EPSG:4326'
    print(f"\n  CRS forzado por extractISO32000: {detected_crs}")
    
    corners = {
        'tl': [tl['lon'], tl['lat']],
        'tr': [tr['lon'], tr['lat']],
        'bl': [bl['lon'], bl['lat']],
        'br': [br['lon'], br['lat']]
    }
    print(f"\n  Corners (lon, lat):")
    for k, v in corners.items():
        print(f"    {k}: {v}")
    
    # Simular createGeoOverlay
    print("\n--- Paso 2: createGeoOverlay ---")
    print(f"  CRS recibido: {detected_crs}")
    
    # Cuando crs == 'EPSG:4326', el código hace:
    # return [n, e] donde input es [lon, lat]
    # Es decir, intercambia lat y lon
    
    def to_wgs84(e, n):
        if detected_crs == 'EPSG:4326':
            return [n, e]  # lat, lng
        else:
            # Aquí usaría proj4
            return [n, e]  # simplificado
    
    tl_ll = to_wgs84(corners['tl'][0], corners['tl'][1])
    tr_ll = to_wgs84(corners['tr'][0], corners['tr'][1])
    bl_ll = to_wgs84(corners['bl'][0], corners['bl'][1])
    br_ll = to_wgs84(corners['br'][0], corners['br'][1])
    
    print(f"\n  Corners transformados a Leaflet [lat, lng]:")
    print(f"    TL: {tl_ll}")
    print(f"    TR: {tr_ll}")
    print(f"    BL: {bl_ll}")
    print(f"    BR: {br_ll}")
    
    # Calcular bounds
    min_lat = min(tl_ll[0], tr_ll[0], bl_ll[0], br_ll[0])
    max_lat = max(tl_ll[0], tr_ll[0], bl_ll[0], br_ll[0])
    min_lng = min(tl_ll[1], tr_ll[1], bl_ll[1], br_ll[1])
    max_lng = max(tl_ll[1], tr_ll[1], bl_ll[1], br_ll[1])
    
    print(f"\n  Bounds resultantes:")
    print(f"    Lat: {min_lat} a {max_lat}")
    print(f"    Lng: {min_lng} a {max_lng}")
    
    # Calcular centro
    center_lat = (min_lat + max_lat) / 2
    center_lng = (min_lng + max_lng) / 2
    print(f"\n  Centro del mapa: {center_lat}, {center_lng}")
    
    # Ahora veamos qué pasa si el PDF fue georreferenciado MANUALMENTE
    # con coordenadas UTM
    print(f"\n--- Analisis de georreferenciacion manual (fallback) ---")
    
    # Si el usuario ingresó coordenadas UTM en el modal:
    # TL: 842x595 -> esquina superior izquierda del PDF
    # El MediaBox es [0, 0, 842, 595]
    # En PDF, Y=0 es abajo, Y=595 es arriba
    # TL en PDF sería (0, 595)
    # TR en PDF sería (842, 595)
    # BL en PDF sería (0, 0)
    # BR en PDF sería (842, 0)
    
    # Pero en nuestro modal de georreferenciación, el usuario ingresa:
    # TL: N, E
    # TR: N, E
    # BL: N, E  
    # BR: N, E
    
    # Y luego createGeoOverlay recibe corners en formato [e, n] para cada esquina
    # y las transforma con proj4(crs, 'EPSG:4326', [e, n])
    
    # El problema potencial: si el PDF tiene rotación o no está alineado,
    # la imagen puede quedar invertida o rotada.
    
    # Veamos la relación entre puntos
    print(f"\n  Distancia entre TL y TR (lon): {abs(corners['tr'][0] - corners['tl'][0]):.6f} grados")
    print(f"  Distancia entre TL y BL (lat): {abs(corners['tl'][1] - corners['bl'][1]):.6f} grados")
    
    # Verificar si hay inconsistencia en el orden
    # TL.lon debería ser similar a BL.lon (izquierda)
    # TR.lon debería ser similar a BR.lon (derecha)
    print(f"\n  Verificacion de alineacion:")
    print(f"    TL.lon ({corners['tl'][0]:.6f}) vs BL.lon ({corners['bl'][0]:.6f}) diff={abs(corners['tl'][0]-corners['bl'][0]):.6f}")
    print(f"    TR.lon ({corners['tr'][0]:.6f}) vs BR.lon ({corners['br'][0]:.6f}) diff={abs(corners['tr'][0]-corners['br'][0]):.6f}")
    print(f"    TL.lat ({corners['tl'][1]:.6f}) vs TR.lat ({corners['tr'][1]:.6f}) diff={abs(corners['tl'][1]-corners['tr'][1]):.6f}")
    print(f"    BL.lat ({corners['bl'][1]:.6f}) vs BR.lat ({corners['br'][1]:.6f}) diff={abs(corners['bl'][1]-corners['br'][1]):.6f}")

if __name__ == '__main__':
    analyze_geopdf_logic(r'C:\Users\LojanoE\Documents\GitHub\MAPS_GIS\IGNORAR\DRQ_PDF.pdf')
    analyze_geopdf_logic(r'C:\Users\LojanoE\Documents\GitHub\MAPS_GIS\IGNORAR\DRT_PDF.pdf')
