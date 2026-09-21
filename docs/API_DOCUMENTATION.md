# TwinEval AI - Complete API Documentation

All API responses follow a strict, standardized JSON format:

#### Success Response (HTTP 200/201)
```json
{
  "success": true,
  "message": "Operation Successful",
  "data": {}
}
```

#### Error Response (HTTP 400/401/403/404/500)
```json
{
  "success": false,
  "message": "Student not found"
}
```

---

## 1. Authentication APIs (`/auth`)

### 1.1 User Login
- **URL**: `POST /auth/login`
- **Access**: Public
- **Headers**: `Content-Type: application/json`
- **Body**:
```json
{
  "email": "sarah.jenkins@twineval.edu",
  "password": "password123"
}
```
- **Success Response (200)**:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user_id": 1,
    "name": "Prof. Sarah Jenkins",
    "email": "sarah.jenkins@twineval.edu",
    "role": "teacher",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### 1.2 User Registration
- **URL**: `POST /auth/register`
- **Access**: Public
- **Body**:
```json
{
  "name": "Prof. Michael Scott",
  "email": "michael.scott@twineval.edu",
  "password": "password123",
  "role": "teacher"
}
```

---

## 2. Student APIs (`/students`)

### 2.1 Get All Students
- **URL**: `GET /students`
- **Access**: Public
- **Query Parameters**:
  - `department` (optional): e.g. `Computer Science`
  - `semester` (optional): e.g. `6`
  - `search` (optional): search by name, email, department
  - `page` (optional, default: `1`)
  - `limit` (optional, default: `10`)
  - `sortBy` (optional, default: `student_id`)
  - `order` (optional: `ASC` / `DESC`)
- **Success Response (200)**:
```json
{
  "success": true,
  "message": "Students retrieved successfully",
  "data": {
    "total": 20,
    "page": 1,
    "limit": 10,
    "totalPages": 2,
    "students": [
      {
        "student_id": 1,
        "name": "Aarav Sharma",
        "email": "aarav.sharma@student.edu",
        "department": "Computer Science",
        "semester": 6,
        "average_ai_score": "92.70",
        "latest_ai_score": "92.70"
      }
    ]
  }
}
```

### 2.2 Get Student By ID
- **URL**: `GET /students/:id`
- **Access**: Public

### 2.3 Create Student
- **URL**: `POST /students`
- **Access**: Private (Bearer Token Required, Role: teacher/admin)
- **Headers**: `Authorization: Bearer <JWT_TOKEN>`
- **Body**:
```json
{
  "name": "Rahul Verma",
  "email": "rahul.verma@student.edu",
  "department": "Computer Science",
  "semester": 4
}
```

### 2.4 Update Student
- **URL**: `PUT /students/:id`
- **Access**: Private (Bearer Token Required)

### 2.5 Delete Student
- **URL**: `DELETE /students/:id`
- **Access**: Private (Bearer Token Required)

### 2.6 Student Leaderboard API
- **URL**: `GET /students/analytics/leaderboard?limit=10`
- **Access**: Public

### 2.7 Student Ranking API
- **URL**: `GET /students/:id/ranking`
- **Access**: Public

### 2.8 Student Performance Trend API
- **URL**: `GET /students/:id/trend`
- **Access**: Public

### 2.9 Student Full Report API
- **URL**: `GET /students/:id/report`
- **Access**: Public
- **Returns**: Student Info, Summary metrics, Evaluation History, AI Score, Latest Learning Plan.

---

## 3. Evaluation APIs (`/evaluations`)

### 3.1 Get All Evaluations
- **URL**: `GET /evaluations`
- **Query Params**: `student_id`, `subject`, `limit`

### 3.2 Create Evaluation (with AI Score Auto-Calculation)
- **URL**: `POST /evaluations`
- **Access**: Private (Bearer Token Required)
- **Body**:
```json
{
  "student_id": 1,
  "subject": "Data Structures & Algorithms",
  "marks": 92.5,
  "attendance": 95,
  "communication": 88,
  "problem_solving": 94,
  "remarks": "Excellent algorithm optimization skills."
}
```
- **Success Response (201)**:
```json
{
  "success": true,
  "message": "Evaluation record created and AI score calculated successfully",
  "data": {
    "evaluation": {
      "evaluation_id": 1,
      "student_id": 1,
      "subject": "Data Structures & Algorithms",
      "marks": "92.50",
      "ai_score": "92.70"
    },
    "ai_analysis": {
      "ai_score": 92.7,
      "performance_grade": "A+",
      "strengths": ["High competency in Class Attendance (95%)"],
      "weaknesses": ["No critical weakness detected; maintain current performance level."],
      "suggestions": ["Excellent overall balanced score! Focus on peer mentoring and advanced projects."]
    }
  }
}
```

---

## 4. Learning Plan APIs (`/plans`)

### 4.1 Get All Plans
- **URL**: `GET /plans`

### 4.2 Create / Generate Learning Plan
- **URL**: `POST /plans`
- **Access**: Private (Bearer Token Required)
- **Body**:
```json
{
  "student_id": 3,
  "weak_topics": ["SQL Query Optimization", "Database Indexing"],
  "recommended_resources": ["W3Schools SQL Tuning", "Coursera DB Course"],
  "practice_tasks": ["Optimize 5 complex queries"],
  "study_schedule": { "week1": "Database Indexing", "week2": "Query Profiling" }
}
```

---

## 5. Dashboard APIs (`/dashboard`)

### 5.1 Get Dashboard Overview
- **URL**: `GET /dashboard`
- **Returns**: Total Students, Average AI Score, Highest Performer, Lowest Performer, Department Statistics, Recent Evaluations.

---

## 6. AI Engine APIs (`/ai`)

### 6.1 Evaluate Student Performance
- **URL**: `POST /ai/evaluate`
- **Body**:
```json
{
  "marks": 85.0,
  "attendance": 90.0,
  "communication": 78.0,
  "problem_solving": 88.0
}
```
- **Response**: Returns `ai_score`, `performance_grade`, `strengths`, `weaknesses`, `suggestions`.

### 6.2 Generate AI Learning Plan
- **URL**: `POST /ai/learning-plan`
- **Body**:
```json
{
  "student_id": 1,
  "subject": "Computer Science",
  "weak_topics": ["Graph Algorithms", "Dynamic Programming"]
}
```

---

## 7. Analytics APIs (`/analytics`)

### 7.1 Get Teacher Analytics
- **URL**: `GET /analytics`

### 7.2 Get Department Analytics Breakdown
- **URL**: `GET /analytics/department`

### 7.3 Get Platform Performance Metrics
- **URL**: `GET /analytics/performance`

### 7.4 Department Comparison API
- **URL**: `GET /analytics/department-comparison`
