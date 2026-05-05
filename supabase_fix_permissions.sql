-- ============================================
-- FIX: Permisos de escritura para anon key
-- Si RLS sigue activo o hay restricciones de API,
-- estas policies permiten todo acceso anonimo.
-- ============================================

-- Asegurar que RLS esta desactivado (por si acaso)
ALTER TABLE IF EXISTS public.qc_markers DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.lsm_markers DISABLE ROW LEVEL SECURITY;

-- Si RLS esta activo a nivel de proyecto, crear policies abiertas
-- Esto permite INSERT, SELECT, UPDATE, DELETE a cualquiera con la anon key

-- QC_MARKERS policies
DROP POLICY IF EXISTS "Allow all anon" ON public.qc_markers;
CREATE POLICY "Allow all anon" ON public.qc_markers
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- LSM_MARKERS policies  
DROP POLICY IF EXISTS "Allow all anon" ON public.lsm_markers;
CREATE POLICY "Allow all anon" ON public.lsm_markers
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- Verificar estado
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('qc_markers', 'lsm_markers');
