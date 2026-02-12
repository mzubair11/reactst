# React Firebase OTP App

## Setup

1. Install dependencies:
   npm install
2. Copy env template and fill Firebase values:
   copy .env.example .env
3. In Firebase Console:
   - Enable Authentication > Sign-in method > Phone.
   - Add your app domain to authorized domains (for local dev add localhost).
4. Start app:
   npm run dev

## Notes
- Phone number format must be E.164, e.g. +15551234567.
- On local development, Firebase may require test phone numbers configured in Console.
- After OTP login, the app opens a sample mobile-first ecommerce flow with Home, Shop, Product, Cart, and Profile pages.
- Sample data is stored in `src/data/categories.json`, `src/data/products.json`, `src/data/orders.json`, and `src/data/banners.json`.
