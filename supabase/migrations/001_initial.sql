-- Mi Cartera - Esquema inicial de base de datos
-- Ejecutar en Supabase SQL Editor o con supabase db push

CREATE TABLE IF NOT EXISTS positions (
  portfolio_key TEXT NOT NULL,
  id TEXT NOT NULL,
  section TEXT NOT NULL,
  asset_kind TEXT,
  name TEXT NOT NULL,
  isin TEXT,
  ticker TEXT,
  symbol TEXT,
  performance_id TEXT,
  shares TEXT,
  currency TEXT,
  type TEXT,
  investment_class TEXT,
  total_invested TEXT,
  invested_weight TEXT,
  market_date TEXT,
  unit_value TEXT,
  total_valuation TEXT,
  profit_euros TEXT,
  valuation_weight TEXT,
  total_return TEXT,
  total_invested_value DOUBLE PRECISION,
  total_valuation_value DOUBLE PRECISION,
  profit_euros_value DOUBLE PRECISION,
  total_return_value DOUBLE PRECISION,
  shares_value DOUBLE PRECISION,
  unit_value_number DOUBLE PRECISION,
  PRIMARY KEY (portfolio_key, id)
);

CREATE TABLE IF NOT EXISTS section_totals (
  portfolio_key TEXT NOT NULL,
  section TEXT NOT NULL,
  total_invested TEXT,
  total_valuation TEXT,
  profit_euros TEXT,
  total_return TEXT,
  total_invested_value DOUBLE PRECISION,
  total_valuation_value DOUBLE PRECISION,
  profit_euros_value DOUBLE PRECISION,
  total_return_value DOUBLE PRECISION,
  PRIMARY KEY (portfolio_key, section)
);

CREATE TABLE IF NOT EXISTS import_metadata (
  portfolio_key TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (portfolio_key, key)
);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  portfolio_key TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  operation_date TEXT NOT NULL,
  quantity DOUBLE PRECISION,
  unit_price DOUBLE PRECISION,
  amount DOUBLE PRECISION,
  fee_amount DOUBLE PRECISION,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_operations_portfolio_asset
  ON operations (portfolio_key, asset_id);

CREATE INDEX IF NOT EXISTS idx_positions_section
  ON positions (portfolio_key, section);
