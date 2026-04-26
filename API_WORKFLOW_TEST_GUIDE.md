# Smart Gas Booking Backend: End-to-End API Testing Guide

This document explains how to test the backend workflow from start to finish with sample data.

Scope covered:

- Auth
- Driver profile and approval
- Vehicle management
- Station management
- Quota
- Booking lifecycle
- QR lifecycle
- Transaction and reversal
- Admin dashboard and analytics
- Reports, notifications, and fraud scan

Assumptions:

- Backend runs at http://localhost:5000
- MongoDB is reachable
- You are using Postman, Insomnia, or curl

## 1. Pre-test setup

1. Install dependencies
   npm install

2. Configure environment

- Copy .env.example to .env
- Set MONGO_URI
- Set JWT_SECRET
- Set ADMIN credentials for seeding

Example .env values:
PORT=5000
NODE_ENV=development
MONGO_URI=mongodb://127.0.0.1:27017/smart-gas-booking
JWT_SECRET=super_long_secret_change_this
JWT_EXPIRES_IN=7d
ADMIN_NAME=System Admin
ADMIN_EMAIL=admin@smartgas.local
ADMIN_PHONE=+251911000001
ADMIN_PASSWORD=Admin#12345

3. Seed admin
   npm run seed:admin

4. Start server
   npm run dev

## 2. Global test conventions

Base URL:
http://localhost:5000/api

Standard headers:
Content-Type: application/json
Authorization: Bearer <TOKEN>

Token variables to keep in your client:

- ADMIN_TOKEN
- DRIVER_TOKEN
- ATTENDANT_TOKEN (optional if using admin to validate/dispense)

Common IDs to capture during tests:

- DRIVER_ID
- VEHICLE_ID
- STATION_ID
- BOOKING_ID
- TRANSACTION_ID
- NOTIFICATION_ID

## 3. Core sample data

Driver registration payload:
{
"name": "Kidus Driver",
"phone": "+251911100001",
"email": "driver1@example.com",
"password": "Driver#123"
}

Driver profile payload:
{
"nationalId": "ET-DRIVER-12345",
"licenseNumber": "LIC-ADDIS-5566",
"photo": "https://example.com/photo.jpg",
"address": "Bole, Addis Ababa",
"city": "Addis Ababa"
}

Vehicle payload:
{
"plateNumber": "AA-12345",
"type": "taxi",
"model": "Toyota Yaris",
"color": "White"
}

Station payload:
{
"name": "Bole Main Station",
"code": "BMS01",
"location": "Bole Road",
"city": "Addis Ababa",
"latitude": 8.995,
"longitude": 38.79,
"fuelTypes": ["petrol", "diesel"],
"fuelStock": {
"petrol": 5000,
"diesel": 4000
},
"status": "open"
}

Booking payload:
{
"station": "<STATION_ID>",
"fuelType": "petrol",
"requestedLiters": 20,
"bookingDate": "2026-04-27",
"timeSlot": "09:00-10:00",
"notes": "Morning refill"
}

Dispense payload:
{
"token": "<QR_TOKEN>",
"liters": 20,
"paymentMethod": "cash",
"pricePerLiter": 90,
"pumpNumber": "P-03"
}

## 4. Phase-by-phase workflow testing

### Phase A: Auth flow

1. Register driver
   POST /auth/register
   Expected: 201, token and user in data

2. Login driver
   POST /auth/login
   Expected: 200, token and user
   Store as DRIVER_TOKEN and DRIVER_ID

3. Get current user
   GET /auth/me
   Auth: DRIVER_TOKEN
   Expected: 200, user object

4. Change password
   PATCH /auth/change-password
   Auth: DRIVER_TOKEN
   Body:
   {
   "currentPassword": "Driver#123",
   "newPassword": "Driver#1234"
   }
   Expected: 200

5. Login admin
   POST /auth/login
   Body:
   {
   "email": "admin@smartgas.local",
   "password": "Admin#12345"
   }
   Expected: 200
   Store ADMIN_TOKEN

### Phase B: Profile and approval flow

1. Driver creates profile
   POST /profile/me
   Auth: DRIVER_TOKEN
   Body: driver profile payload
   Expected: 201 (first time) or 200 (update)

2. Admin checks pending drivers
   GET /profile/pending
   Auth: ADMIN_TOKEN
   Expected: 200 with profile list

3. Admin approves driver
   PATCH /profile/approve/<DRIVER_ID>
   Auth: ADMIN_TOKEN
   Expected: 200

Optional negative checks:

- PATCH /profile/reject/<DRIVER_ID>
- PATCH /profile/suspend/<DRIVER_ID>

### Phase C: Vehicle and station flow

1. Driver adds vehicle
   POST /vehicles
   Auth: DRIVER_TOKEN
   Body: vehicle payload
   Expected: 201
   Store VEHICLE_ID

2. Add second and third vehicles (max check)
   POST /vehicles (2 times)
   Expected: first 2 succeed until count is 3

3. Try fourth vehicle
   POST /vehicles
   Expected: 400 with max 3 vehicles message

4. Set active vehicle
   PATCH /vehicles/<VEHICLE_ID>/active
   Auth: DRIVER_TOKEN
   Expected: 200

5. Admin creates station
   POST /stations
   Auth: ADMIN_TOKEN
   Body: station payload
   Expected: 201
   Store STATION_ID

6. Public station list and nearby
   GET /stations
   GET /stations/nearby?city=Addis%20Ababa&latitude=8.995&longitude=38.79
   Expected: 200

### Phase D: Quota and booking flow

1. Driver initializes quota
   POST /quotas/init
   Auth: DRIVER_TOKEN
   Expected: 201 or 200

2. Driver reads quota
   GET /quotas/me
   Auth: DRIVER_TOKEN
   Expected: 200 with monthlyLimit, usedLiters, remainingLiters

3. Driver creates booking
   POST /bookings
   Auth: DRIVER_TOKEN
   Body: booking payload
   Expected: 201
   Store BOOKING_ID

4. Double active booking negative test
   POST /bookings again without cancelling/completing first
   Expected: 409

5. Driver sees own bookings
   GET /bookings/me
   Auth: DRIVER_TOKEN
   Expected: 200

6. Admin booking list
   GET /bookings/admin/all
   Auth: ADMIN_TOKEN
   Expected: 200

7. Cancel booking flow (optional)
   PATCH /bookings/cancel/<BOOKING_ID>
   Auth: DRIVER_TOKEN
   Body:
   {
   "reason": "Plan changed"
   }
   Expected: 200

8. Expire bookings job endpoint
   POST /bookings/admin/expire
   Auth: ADMIN_TOKEN
   Expected: 200

### Phase E: QR workflow

Precondition: booking status must be confirmed and in allowed time window.

1. Generate QR
   POST /qr/generate/<BOOKING_ID>
   Auth: DRIVER_TOKEN
   Expected: 200, capture QR_TOKEN

2. Read active QR
   GET /qr/me/<BOOKING_ID>
   Auth: DRIVER_TOKEN
   Expected: 200

3. Validate QR at station (admin or attendant)
   POST /qr/validate
   Auth: ADMIN_TOKEN or ATTENDANT_TOKEN
   Body:
   {
   "token": "<QR_TOKEN>"
   }
   Expected: 200

4. Negative tests

- Reuse same QR after dispense: should fail
- Expired QR: should fail
- Wrong owner invalidate attempt: should fail with 403

### Phase F: Transaction workflow

1. Dispense fuel
   POST /transactions/dispense
   Auth: ADMIN_TOKEN or ATTENDANT_TOKEN
   Body: dispense payload
   Expected: 201
   Store TRANSACTION_ID

2. Driver transactions
   GET /transactions/me
   Auth: DRIVER_TOKEN
   Expected: 200

3. Station transactions
   GET /transactions/station
   Auth: ADMIN_TOKEN or ATTENDANT_TOKEN
   Expected: 200

4. Receipt
   GET /transactions/receipt/<TRANSACTION_ID>
   Auth: DRIVER_TOKEN or ADMIN_TOKEN
   Expected: 200

5. Transaction details
   GET /transactions/<TRANSACTION_ID>
   Auth: DRIVER_TOKEN or ADMIN_TOKEN
   Expected: 200

6. Reverse transaction
   PATCH /transactions/reverse/<TRANSACTION_ID>
   Auth: ADMIN_TOKEN
   Expected: 200

### Phase G: Admin APIs

1. Dashboard
   GET /admin/dashboard

2. Activity
   GET /admin/activity

3. Users with pagination
   GET /admin/users?page=1&limit=20

4. Pending driver queue
   GET /admin/drivers/pending

5. Booking filters
   GET /admin/bookings?status=confirmed

6. Analytics
   GET /admin/analytics

7. Fraud alerts
   GET /admin/fraud-alerts

8. System health
   GET /admin/system-health

All above require ADMIN_TOKEN and should return 200.

### Phase H: Reports, notifications, audit, fraud scan

1. Daily report
   GET /reports/daily?date=2026-04-27
   Auth: ADMIN_TOKEN

2. Monthly report
   GET /reports/monthly?month=4&year=2026
   Auth: ADMIN_TOKEN

3. Station report
   GET /reports/stations/<STATION_ID>
   Auth: ADMIN_TOKEN

4. Driver report
   GET /reports/drivers/<DRIVER_ID>
   Auth: ADMIN_TOKEN

5. Export
   GET /reports/export?type=daily&date=2026-04-27
   Auth: ADMIN_TOKEN

6. Broadcast notification
   POST /reports/notifications/broadcast
   Auth: ADMIN_TOKEN
   Body:
   {
   "role": "driver",
   "title": "Fuel Update",
   "message": "Petrol queue reduced at BMS01",
   "type": "info"
   }
   Expected: 201

7. Driver reads notifications
   GET /reports/notifications/me
   Auth: DRIVER_TOKEN
   Expected: 200, capture NOTIFICATION_ID

8. Mark notification read
   PATCH /reports/notifications/<NOTIFICATION_ID>/read
   Auth: DRIVER_TOKEN
   Expected: 200

9. Fraud scan
   GET /reports/fraud/scan
   Auth: ADMIN_TOKEN
   Expected: 200

## 5. Suggested Postman environment variables

BASE_URL = http://localhost:5000/api
ADMIN_TOKEN =
DRIVER_TOKEN =
ATTENDANT_TOKEN =
DRIVER_ID =
VEHICLE_ID =
STATION_ID =
BOOKING_ID =
QR_TOKEN =
TRANSACTION_ID =
NOTIFICATION_ID =

## 6. Quick failure checklist

If requests fail unexpectedly, verify:

- .env values are loaded
- MongoDB is connected
- ADMIN account exists (seed command)
- Driver profile is approved before booking
- Driver has active vehicle before quota init and booking
- Station is open and has stock for selected fuel type
- Booking timeSlot format is exactly HH:mm-HH:mm
- QR generation is in allowed window and not too early
- JWT token is valid and includes correct role

## 7. Minimal curl examples

Register:
curl -X POST http://localhost:5000/api/auth/register -H "Content-Type: application/json" -d '{"name":"Kidus Driver","phone":"+251911100001","email":"driver1@example.com","password":"Driver#123"}'

Login:
curl -X POST http://localhost:5000/api/auth/login -H "Content-Type: application/json" -d '{"email":"driver1@example.com","password":"Driver#123"}'

Create station (admin):
curl -X POST http://localhost:5000/api/stations -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d '{"name":"Bole Main Station","code":"BMS01","location":"Bole Road","city":"Addis Ababa","fuelTypes":["petrol","diesel"],"fuelStock":{"petrol":5000,"diesel":4000},"status":"open"}'

Create booking (driver):
curl -X POST http://localhost:5000/api/bookings -H "Authorization: Bearer <DRIVER_TOKEN>" -H "Content-Type: application/json" -d '{"station":"<STATION_ID>","fuelType":"petrol","requestedLiters":20,"bookingDate":"2026-04-27","timeSlot":"09:00-10:00"}'

Dispense fuel (admin/attendant):
curl -X POST http://localhost:5000/api/transactions/dispense -H "Authorization: Bearer <ADMIN_TOKEN>" -H "Content-Type: application/json" -d '{"token":"<QR_TOKEN>","liters":20,"paymentMethod":"cash","pricePerLiter":90,"pumpNumber":"P-03"}'

## 8. Recommended execution order summary

1. Seed admin and login admin
2. Register driver and login driver
3. Create and approve driver profile
4. Add vehicle and set active
5. Create station
6. Initialize quota
7. Create booking
8. Generate and validate QR
9. Dispense fuel and fetch receipt
10. Test reverse transaction
11. Test admin dashboards and analytics
12. Test reports and notifications
13. Run fraud scan

This gives full functional coverage from beginning to end.
