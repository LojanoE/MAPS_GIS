-- ============================================================
-- MAPS GIS - Supabase Schema (LSM + Config)
-- Ejecutar esto en el SQL Editor de Supabase
-- ============================================================

-- ============================================================
-- 1. TABLA DE MARCADORES LSM
-- ============================================================
create table if not exists lsm_markers (
    id uuid primary key default gen_random_uuid(),
    nickname text not null,
    device_id text,
    local_marker_id text unique,
    
    -- Coordenadas
    lat double precision not null,
    lng double precision not null,
    norte text,
    este text,
    
    -- Visual
    color text default 'red',
    photos_count int default 0,
    
    -- Campos LSM
    nombre_muestra text not null,
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
    ensayos text[] default '{}',
    
    created_at timestamptz default now()
);

-- Habilitar RLS
alter table lsm_markers enable row level security;

-- Políticas públicas (sin auth, ya que usamos nickname + device_id)
create policy "Allow all inserts"
    on lsm_markers for insert
    to anon, authenticated
    with check (true);

create policy "Allow all selects"
    on lsm_markers for select
    to anon, authenticated
    using (true);

-- ============================================================
-- 2. TABLA DE CONFIGURACIÓN (Listas desplegables compartidas)
-- ============================================================
create table if not exists app_config (
    id uuid primary key default gen_random_uuid(),
    config_key text unique not null check (config_key in (
        'tipo_muestra', 'nombre_proyecto', 'solicitante',
        'estructura_deposito', 'subestructuras', 'categoria',
        'tipo_material', 'proveniencia', 'localizacion',
        'fuente', 'ensayos'
    )),
    config_values text[] default '{}',
    updated_at timestamptz default now()
);

alter table app_config enable row level security;

create policy "Allow all reads on config"
    on app_config for select
    to anon, authenticated
    using (true);

create policy "Allow all modifications on config"
    on app_config for all
    to anon, authenticated
    using (true)
    with check (true);

-- Insertar registros vacíos iniciales (evita errores de FK/insert)
insert into app_config (config_key, config_values) values
('tipo_muestra', '{}'),
('nombre_proyecto', '{}'),
('solicitante', '{}'),
('estructura_deposito', '{}'),
('subestructuras', '{}'),
('categoria', '{}'),
('tipo_material', '{}'),
('proveniencia', '{}'),
('localizacion', '{}'),
('fuente', '{}'),
('ensayos', '{}')
on conflict (config_key) do nothing;
