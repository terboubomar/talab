# TALAB Driver App

Expo/React Native app for restaurant-owned delivery drivers.

## Scope

The app intentionally exposes only the driver workflow:

- Supabase staff login
- assigned delivery orders only
- customer phone and delivery address
- open navigation
- cash-on-delivery collection cue
- order item/detail view
- `ready -> out_for_delivery`
- `out_for_delivery -> completed`
- realtime refresh when assigned orders change

The database is the security boundary. The `driver` role cannot read other branch orders merely by calling the Supabase API directly; RLS limits drivers to orders where `orders.driver_id = app.current_staff_id()`.

## Local setup

```bash
cd apps/driver
cp .env.example .env
npm install
npm start
```

Fill `.env` with the TALAB Supabase **public** project URL and publishable/anon key. Never put a service-role key or any provider secret in the mobile app.

## Driver account requirements

The staff account must:

1. exist in Supabase Auth,
2. be linked to `public.staff.user_id`,
3. have the tenant `driver` role,
4. be active,
5. be assigned to the appropriate branch when branch scoping is used.

Restaurant staff assigns an order to the driver from `/admin/orders`. The order then appears automatically in the Driver App.

## Not in this foundation

- continuous/background driver location tracking
- proof-of-delivery photos/signatures
- push notifications
- route optimization
- external delivery-company driver accounts

Those are intentionally not fabricated beyond the current BUILD-SPEC scope.
