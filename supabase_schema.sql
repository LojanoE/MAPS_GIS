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

-- Insertar valores de ejemplo por defecto
insert into app_config (config_key, config_values) values
('tipo_muestra', '{"Suelo","Roca","Concreto","Asfalto","Agregado"}'),
('nombre_proyecto', '{"Proyecto A","Proyecto B","Proyecto C"}'),
('solicitante', '{"Ing. Lopez","Ing. Garcia","Cliente XYZ"}'),
('estructura_deposito', '{"Mina Principal","Pila 1","Pila 2","Tajeo 3N"}'),
('subestructuras', '{"Nivel 1","Nivel 2","Nivel 3","Zona A","Zona B"}'),
('categoria', '{"Exploracion","Control","Verificacion","Rutina"}'),
('tipo_material', '{"Arcilla","Arena","Grava","Roca Dura","Roca Blanda"}'),
('proveniencia', '{"In Situ","Planta","Laboratorio","Stock"}'),
('localizacion', '{"Frente Norte","Frente Sur","Frente Este","Frente Oeste","Planta"}'),
('fuente', '{"Muestreo Directo","Canal","Testigo","Cuchareo"}'),
('ensayos', '{"Granulometria","Humedad","Densidad","CBR","Proctor","Plasticidad","Contenido de Humedad","Resistencia a Compresion"}')
on conflict (config_key) do update set config_values = excluded.config_values;
