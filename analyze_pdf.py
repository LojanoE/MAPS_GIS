import sys
import json
import re

def analyze_pdf(path):
    with open(path, 'rb') as f:
        data = f.read()
    
    text = data.decode('latin1', errors='ignore')
    
    print(f"\n{'='*60}")
    print(f"ANALIZANDO: {path}")
    print(f"{'='*60}")
    
    # Buscar GPTS
    gpts_matches = list(re.finditer(r'/GPTS\s*\[([^\]]+)\]', text))
    print(f"\nGPTS encontrados: {len(gpts_matches)}")
    for i, m in enumerate(gpts_matches):
        vals = [float(x) for x in m.group(1).strip().split()]
        print(f"  GPTS #{i+1}: {vals}")
    
    # Buscar LPTS
    lpts_matches = list(re.finditer(r'/LPTS\s*\[([^\]]+)\]', text))
    print(f"\nLPTS encontrados: {len(lpts_matches)}")
    for i, m in enumerate(lpts_matches):
        vals = [float(x) for x in m.group(1).strip().split()]
        print(f"  LPTS #{i+1}: {vals}")
    
    # Buscar Measure
    measure_matches = list(re.finditer(r'/Measure\s*<<', text))
    print(f"\nMeasure encontrados: {len(measure_matches)}")
    
    # Buscar CTM
    ctm_matches = list(re.finditer(r'/CTM\s*\[([^\]]+)\]', text))
    print(f"\nCTM encontrados: {len(ctm_matches)}")
    for i, m in enumerate(ctm_matches):
        vals = [float(x) for x in m.group(1).strip().split()]
        print(f"  CTM #{i+1}: {vals}")
    
    # Buscar Bounds
    bounds_matches = list(re.finditer(r'/Bounds\s*\[\s*([^\]]+)\]', text))
    print(f"\nBounds encontrados: {len(bounds_matches)}")
    for i, m in enumerate(bounds_matches):
        vals = [float(x) for x in m.group(1).strip().split()]
        print(f"  Bounds #{i+1}: {vals}")
    
    # Buscar MediaBox
    mediabox_matches = list(re.finditer(r'/MediaBox\s*\[\s*([^\]]+)\]', text))
    print(f"\nMediaBox encontrados: {len(mediabox_matches)}")
    for i, m in enumerate(mediabox_matches):
        vals = [float(x) for x in m.group(1).strip().split()]
        print(f"  MediaBox #{i+1}: {vals}")
    
    # Buscar EPSG
    epsg_matches = list(re.finditer(r'EPSG[:\s]*(\d+)', text))
    print(f"\nEPSG encontrados: {len(epsg_matches)}")
    for m in epsg_matches:
        print(f"  EPSG:{m.group(1)}")
    
    # Buscar PSAD56
    if re.search(r'PSAD[\s_]?56', text):
        print("  PSAD56 detectado")
    
    # Buscar WGS84
    if re.search(r'WGS[\s_]?84', text):
        print("  WGS84 detectado")
    
    # Buscar UTM
    utm_matches = list(re.finditer(r'UTM[\s_]+Zone[\s_]*(\d+)[\s_]*(N|S)', text, re.I))
    print(f"\nUTM encontrados: {len(utm_matches)}")
    for m in utm_matches:
        print(f"  UTM Zone {m.group(1)}{m.group(2).upper()}")
    
    # Buscar LGIDict
    if re.search(r'/LGIDict', text):
        print("\n  LGIDict detectado")
    
    # Buscar Viewport
    vp_matches = list(re.finditer(r'/VP\s*\[', text))
    print(f"\nViewports encontrados: {len(vp_matches)}")

if __name__ == '__main__':
    analyze_pdf(r'C:\Users\LojanoE\Documents\GitHub\MAPS_GIS\IGNORAR\DRQ_PDF.pdf')
    analyze_pdf(r'C:\Users\LojanoE\Documents\GitHub\MAPS_GIS\IGNORAR\DRT_PDF.pdf')
