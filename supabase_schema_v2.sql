-- ============================================
-- MAPS GIS v2.0 - Supabase Schema
-- Elimina tablas anteriores y crea nuevas con auditoría
-- ============================================

-- ============================================
-- DROP TABLAS EXISTENTES (si existen)
-- ============================================
DROP TABLE IF EXISTS public.qc_markers CASCADE;
DROP TABLE IF EXISTS public.lsm_markers CASCADE;
DROP TABLE IF EXISTS public.app_config CASCADE;

-- ============================================
-- TABLA: qc_markers
-- Marcadores de Control de Calidad (QC)
-- ============================================
CREATE TABLE public.qc_markers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id text NOT NULL,
    local_marker_id text NOT NULL,
    user_name text NOT NULL,
    name text NOT NULL,
    description text,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    norte text,
    este text,
    color text DEFAULT 'red',
    photos_count int DEFAULT 0,
    photo_ids text[] DEFAULT '{}',
    is_deleted boolean DEFAULT false,
    deleted_at timestamptz,
    deleted_by text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Desactivar RLS (la app maneja su propia seguridad)
ALTER TABLE public.qc_markers DISABLE ROW LEVEL SECURITY;

-- Índices
CREATE INDEX idx_qc_device ON public.qc_markers(device_id);
CREATE INDEX idx_qc_deleted ON public.qc_markers(is_deleted);
CREATE INDEX idx_qc_local_id ON public.qc_markers(local_marker_id);
CREATE INDEX idx_qc_user ON public.qc_markers(user_name);
CREATE INDEX idx_qc_created ON public.qc_markers(created_at);

-- ============================================
-- TABLA: lsm_markers
-- Marcadores de Laboratorio (LSM) - Muestras
-- ============================================
CREATE TABLE public.lsm_markers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id text NOT NULL,
    local_marker_id text NOT NULL,
    user_name text NOT NULL,
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    norte text,
    este text,
    color text DEFAULT 'red',
    photos_count int DEFAULT 0,
    photo_ids text[] DEFAULT '{}',
    nombre_muestra text NOT NULL,
    tipo_muestra text,
    nombre_proyecto text,
    solicitante text,
    estructura_deposito text,
    subestructuras text,
    categoria text,
    tipo_material text,
    proveniencia text,
    localizacion text,
    fuente text,
    ensayos text[] DEFAULT '{}',
    is_deleted boolean DEFAULT false,
    deleted_at timestamptz,
    deleted_by text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- Desactivar RLS
ALTER TABLE public.lsm_markers DISABLE ROW LEVEL SECURITY;

-- Índices
CREATE INDEX idx_lsm_device ON public.lsm_markers(device_id);
CREATE INDEX idx_lsm_deleted ON public.lsm_markers(is_deleted);
CREATE INDEX idx_lsm_local_id ON public.lsm_markers(local_marker_id);
CREATE INDEX idx_lsm_user ON public.lsm_markers(user_name);
CREATE INDEX idx_lsm_created ON public.lsm_markers(created_at);

-- ============================================
-- TABLA: app_config
-- Configuración global (opcional, para uso futuro)
-- ============================================
CREATE TABLE public.app_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key text UNIQUE NOT NULL CHECK (
        config_key IN (
            'tipo_muestra', 'nombre_proyecto', 'solicitante',
            'estructura_deposito', 'subestructuras', 'categoria',
            'tipo_material', 'proveniencia', 'localizacion',
            'fuente', 'ensayos'
        )
    ),
    config_values text[] DEFAULT '{}',
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.app_config DISABLE ROW LEVEL SECURITY;

-- Realtime para config
alter publication supabase_realtime add table public.app_config;

-- ============================================
-- POLÍTICAS DE ACCESO (API Key)
-- ============================================
-- Como RLS está desactivado, cualquiera con la anon key puede acceder
-- La seguridad está en la app (contraseña de admin)

-- ============================================
-- DATOS INICIALES (opcional)
-- ============================================
INSERT INTO public.app_config (config_key, config_values) VALUES
('tipo_muestra', ARRAY['Suelo','Roca','Concreto','Asfalto','Agregado']),
('nombre_proyecto', ARRAY['Proyecto A','Proyecto B','Proyecto C']),
('solicitante', ARRAY['Ing. Lopez','Ing. Garcia','Cliente XYZ']),
('estructura_deposito', ARRAY['Mina Principal','Pila 1','Pila 2','Tajeo 3N']),
('subestructuras', ARRAY['Nivel 1','Nivel 2','Nivel 3','Zona A','Zona B']),
('categoria', ARRAY['Exploracion','Control','Verificacion','Rutina']),
('tipo_material', ARRAY['Arcilla','Arena','Grava','Roca Dura','Roca Blanda']),
('proveniencia', ARRAY['In Situ','Planta','Laboratorio','Stock']),
('localizacion', ARRAY['Frente Norte','Frente Sur','Frente Este','Frente Oeste','Planta']),
('fuente', ARRAY['Muestreo Directo','Canal','Testigo','Cuchareo']),
('ensayos', ARRAY['HUM','GEP','GTM','GFI','GHD','ELA','EDL','COM','ABF','ABG','ICP','SLF','PRA','TIS','VDC','DCP','DCA','PMF','PET','CLS','PPF','PPR','DPS','DMI','DMA','GEG','CUS','TCU','TCD','TUU','CUR','TXR','RTI','PGF','ABA','DNU','LEO','CFR','CST','GTA','CMO','COS'])
ON CONFLICT (config_key) DO NOTHING;
