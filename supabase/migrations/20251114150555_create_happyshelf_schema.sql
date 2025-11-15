/*
  # HappyShelf Database Schema

  ## Overview
  Creates the complete database schema for HappyShelf inventory management system.

  ## New Tables
  
  ### users
  - `id` (uuid, primary key) - Unique user identifier
  - `email` (text, unique) - User email for login
  - `password_hash` (text) - Bcrypt hashed password
  - `name` (text) - User's full name
  - `created_at` (timestamptz) - Account creation timestamp
  
  ### inventory_items
  - `id` (uuid, primary key) - Unique item identifier
  - `user_id` (uuid, foreign key) - Owner of the item
  - `name` (text) - Item name
  - `category` (text) - Item category
  - `quantity` (integer) - Current quantity in stock
  - `daily_usage` (numeric) - Daily consumption rate
  - `expiry_date` (date) - Item expiration date
  - `created_at` (timestamptz) - Record creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  
  ### Row Level Security (RLS)
  - Enable RLS on both tables
  - Users table: Users can only read their own profile
  - Inventory table: Users can only manage their own items
  
  ### Policies
  1. **users table**
     - SELECT: Users can view their own data
     - UPDATE: Users can update their own profile
  
  2. **inventory_items table**
     - SELECT: Users can view their own items
     - INSERT: Users can create items for themselves
     - UPDATE: Users can update their own items
     - DELETE: Users can delete their own items

  ## Notes
  - Passwords are stored as bcrypt hashes, never plain text
  - All timestamps use UTC timezone
  - Daily usage is stored as numeric for decimal precision
  - Foreign key constraint ensures referential integrity
*/

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL,
  quantity integer NOT NULL DEFAULT 0,
  daily_usage numeric NOT NULL DEFAULT 0,
  expiry_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own items"
  ON inventory_items FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own items"
  ON inventory_items FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own items"
  ON inventory_items FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own items"
  ON inventory_items FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_inventory_user_id ON inventory_items(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory_items(expiry_date);
