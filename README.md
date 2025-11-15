# HappyShelf - Inventory Management System

A complete inventory management application with JWT authentication, built with React, Express, and Supabase.

## Features

- **Authentication**: JWT-based login and registration system
- **Dashboard**: Clean green-themed UI with real-time stats
- **Inventory Management**: Full CRUD operations for inventory items
- **Smart Alerts**: Automatic warnings for low stock and expiring items
- **Analytics**: Visual cards showing total items, low stock, and expiring soon
- **Calculations**: Automatic computation of days left based on quantity and daily usage

## Tech Stack

### Frontend
- React + TypeScript
- Tailwind CSS (green/environment theme)
- Lucide React (icons)
- Vite (build tool)

### Backend
- Node.js + Express
- JWT authentication with bcrypt
- Supabase (PostgreSQL database)
- RESTful API design

## Project Structure

```
/
├── src/                      # Frontend React application
│   ├── components/           # React components
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   ├── Dashboard.tsx
│   │   ├── InventoryTable.tsx
│   │   ├── ItemModal.tsx
│   │   ├── StatCard.tsx
│   │   └── AlertCard.tsx
│   ├── contexts/             # React context providers
│   │   └── AuthContext.tsx
│   ├── services/             # API service layer
│   │   └── api.ts
│   ├── App.tsx
│   └── main.tsx
│
└── backend/                  # Express backend API
    ├── src/
    │   ├── config/
    │   │   └── supabase.js   # Supabase client config
    │   ├── controllers/
    │   │   ├── authController.js
    │   │   └── inventoryController.js
    │   ├── middleware/
    │   │   └── auth.js       # JWT middleware
    │   ├── routes/
    │   │   ├── authRoutes.js
    │   │   └── inventoryRoutes.js
    │   └── server.js
    └── package.json
```

## Database Schema

### users
- `id` (uuid, primary key)
- `email` (text, unique)
- `password_hash` (text)
- `name` (text)
- `created_at` (timestamptz)

### inventory_items
- `id` (uuid, primary key)
- `user_id` (uuid, foreign key)
- `name` (text)
- `category` (text)
- `quantity` (integer)
- `daily_usage` (numeric)
- `expiry_date` (date, nullable)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

## Setup Instructions

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- Supabase account

### 1. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in the `backend` directory:

```env
PORT=5000
JWT_SECRET=your_jwt_secret_here
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
```

Get your Supabase credentials from your Supabase project dashboard.

### 2. Frontend Setup

```bash
npm install
```

Create a `.env` file in the root directory:

```env
VITE_API_URL=http://localhost:5000/api
```

## Running the Application

### Start Backend Server

```bash
cd backend
npm run dev
```

The backend will run on `http://localhost:5000`

### Start Frontend Development Server

In a new terminal:

```bash
npm run dev
```

The frontend will run on `http://localhost:5173` (or the next available port)

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user

### Inventory (Protected)
- `GET /api/inventory/items` - Get all items
- `POST /api/inventory/items` - Create new item
- `PUT /api/inventory/items/:id` - Update item
- `DELETE /api/inventory/items/:id` - Delete item
- `GET /api/inventory/stats` - Get dashboard statistics

## Key Features Explained

### Days Left Calculation
```
daysLeft = quantity / daily_usage
```

### Alert System
- **Low Stock**: Items with less than 3 days remaining
- **Expiring Soon**: Items expiring within 7 days

### Status Colors
- **Green**: Good stock (7+ days or 14+ days to expiry)
- **Orange**: Warning (3-7 days or 7-14 days to expiry)
- **Red**: Critical (< 3 days or < 7 days to expiry)

## Security Features

- Passwords hashed with bcrypt (10 rounds)
- JWT tokens expire in 7 days
- Protected API routes with middleware
- Row Level Security (RLS) enabled on database
- Users can only access their own data

## Building for Production

### Frontend
```bash
npm run build
```

### Backend
```bash
cd backend
npm start
```

## Notes

- The database schema is automatically created using Supabase migrations
- RLS policies ensure data isolation between users
- All API calls require authentication except login/register
- The app uses a clean, modern green theme optimized for production use
