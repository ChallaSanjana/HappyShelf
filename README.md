# HappyShelf - Inventory Management System

A complete inventory management application with JWT authentication, built with React, Express, and MongoDB.

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
- MongoDB + Mongoose (NoSQL database)
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
    │   │   └── database.js   # MongoDB connection config
    │   ├── models/
    │   │   ├── User.js       # User Mongoose model
    │   │   └── Item.js       # Item Mongoose model
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

### Users Collection
- `_id` (ObjectId, primary key)
- `email` (String, unique, required)
- `password_hash` (String, required)
- `name` (String, required)
- `createdAt` (Date, auto-generated)
- `updatedAt` (Date, auto-generated)

### Inventory Items Collection
- `_id` (ObjectId, primary key)
- `user_id` (ObjectId, reference to Users, required)
- `name` (String, required)
- `category` (String, required)
- `quantity` (Number, required)
- `daily_usage` (Number, required)
- `expiry_date` (Date, nullable)
- `createdAt` (Date, auto-generated)
- `updatedAt` (Date, auto-generated)

**Note**: Dashboard metrics (totalItems, lowStockItems, expiringSoon, predictedSavings, carbonReduced) are calculated on-the-fly and not stored in the database.

## Setup Instructions

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn
- MongoDB (local installation or MongoDB Atlas account)

### 1. Backend Setup

```bash
cd backend
npm install
```

Create a `.env` file in the `backend` directory:

```env
PORT=5000
JWT_SECRET=your_jwt_secret_here
MONGODB_URI=mongodb://localhost:27017/happyshelf
# Or use MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/happyshelf
```

**MongoDB Options:**
- **Local**: Install MongoDB Community Server from [mongodb.com](https://www.mongodb.com/try/download/community)
- **Cloud**: Create a free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)

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

- MongoDB collections are automatically created when data is first inserted
- User data is isolated by user_id foreign key references
- All API calls require JWT authentication except login/register endpoints
- The app uses a clean, modern green theme optimized for production use
- Dashboard metrics are calculated on-the-fly from inventory data, not stored in database
