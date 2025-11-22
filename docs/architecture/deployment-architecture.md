# Deployment & Service Architecture

This document provides a comprehensive overview of the deployment architecture for both production and development environments, including all services, frameworks, and their communication patterns.

## Architecture Overview

```mermaid
graph TB
    subgraph "Production Environment"
        subgraph "Client Layer"
            Client[Client Browser]
            CDN[Vercel CDN]
        end

        subgraph "Frontend - Vercel"
            NextJS[Next.js Application<br/>SSR & Routing]
            VercelEdge[Vercel Edge Functions]
        end

        subgraph "Backend - AWS Elastic Beanstalk"
            ALB[Application Load Balancer]
            subgraph "EC2 Instances"
                Uvicorn1[Uvicorn ASGI Server<br/>Instance 1]
                Uvicorn2[Uvicorn ASGI Server<br/>Instance 2]
                FastAPI[FastAPI Application]
            end
        end

        subgraph "Data Layer - AWS"
            RDS[(AWS RDS PostgreSQL<br/>Database)]
            S3[AWS S3<br/>Object Storage<br/>Files & Assets]
            SES[AWS SES<br/>Email Service]
        end

        subgraph "Cache Layer"
            RedisCloud[(Redis Cloud<br/>Caching & Sessions)]
        end

        subgraph "External Services"
            QontinuiAPI[qontinui-api<br/>Core ML Service]
        end
    end

    %% Production Flow
    Client -->|HTTPS| CDN
    CDN -->|Static Assets| NextJS
    NextJS -->|API Requests| ALB
    ALB -->|Load Balance| Uvicorn1
    ALB -->|Load Balance| Uvicorn2
    Uvicorn1 --> FastAPI
    Uvicorn2 --> FastAPI
    FastAPI -->|Read/Write| RDS
    FastAPI -->|Store/Retrieve| S3
    FastAPI -->|Send Emails| SES
    FastAPI -->|Cache/Session| RedisCloud
    FastAPI -->|ML Processing| QontinuiAPI
    NextJS -->|SSR Data| RedisCloud

    style NextJS fill:#0070f3
    style FastAPI fill:#009688
    style RDS fill:#527FFF
    style S3 fill:#569A31
    style SES fill:#DD344C
    style RedisCloud fill:#DC382D
```

## Development Environment

```mermaid
graph TB
    subgraph "Development Environment - Docker Compose"
        subgraph "Developer Machine"
            Browser[Developer Browser<br/>localhost:3000]
        end

        subgraph "Frontend Container"
            NextDev[Next.js Dev Server<br/>Port 3000<br/>Hot Reload]
        end

        subgraph "Backend Container"
            UvicornDev[Uvicorn Dev Server<br/>Port 8000<br/>Auto Reload]
            FastAPIDev[FastAPI Application<br/>Debug Mode]
        end

        subgraph "Database Container"
            PostgresLocal[(PostgreSQL<br/>Port 5432<br/>Local DB)]
        end

        subgraph "Cache Container"
            RedisLocal[(Redis<br/>Port 6379<br/>Local Cache)]
        end

        subgraph "Storage Container"
            MinIO[MinIO S3-Compatible<br/>Port 9000<br/>Local Object Storage]
        end

        subgraph "Email Container"
            Mailhog[Mailhog<br/>Port 1025/8025<br/>Email Testing]
        end

        subgraph "External Development"
            QontinuiAPIDev[qontinui-api<br/>Local/Staging]
        end
    end

    %% Development Flow
    Browser -->|HTTP| NextDev
    NextDev -->|API Proxy| UvicornDev
    UvicornDev --> FastAPIDev
    FastAPIDev -->|Query| PostgresLocal
    FastAPIDev -->|Store| MinIO
    FastAPIDev -->|Send| Mailhog
    FastAPIDev -->|Cache| RedisLocal
    FastAPIDev -->|ML API| QontinuiAPIDev
    NextDev -->|Cache| RedisLocal

    style NextDev fill:#0070f3
    style FastAPIDev fill:#009688
    style PostgresLocal fill:#336791
    style RedisLocal fill:#DC382D
    style MinIO fill:#C72E49
    style Mailhog fill:#6F42C1
```

## Cross-Service Communication Patterns

```mermaid
sequenceDiagram
    participant Client
    participant Vercel as Vercel/Next.js
    participant CDN as Vercel CDN
    participant ALB as AWS Load Balancer
    participant Backend as Uvicorn/FastAPI
    participant Redis
    participant RDS as PostgreSQL
    participant S3
    participant SES
    participant API as qontinui-api

    Note over Client,API: Static Asset Request
    Client->>CDN: Request Static Assets
    CDN-->>Client: Cached Assets (HTML/CSS/JS)

    Note over Client,API: SSR Page Request
    Client->>Vercel: Request Page
    Vercel->>Redis: Check Cache
    alt Cache Hit
        Redis-->>Vercel: Cached Data
    else Cache Miss
        Vercel->>Backend: Fetch Data
        Backend->>RDS: Query Data
        RDS-->>Backend: Return Data
        Backend-->>Vercel: JSON Response
        Vercel->>Redis: Store Cache
    end
    Vercel-->>Client: Rendered HTML

    Note over Client,API: API Request with File Upload
    Client->>Vercel: Form Submission
    Vercel->>ALB: API Request
    ALB->>Backend: Route to Instance
    Backend->>S3: Upload File
    S3-->>Backend: File URL
    Backend->>RDS: Save Metadata
    RDS-->>Backend: Confirmation
    Backend->>API: Process with ML
    API-->>Backend: ML Results
    Backend->>Redis: Cache Results
    Backend-->>Vercel: Success Response
    Vercel-->>Client: UI Update

    Note over Client,API: Email Notification
    Backend->>SES: Send Email
    SES-->>Backend: Delivery Status
```

## Service Responsibilities

### Frontend Layer

#### Vercel (Production)
- **Hosting**: Serverless deployment of Next.js application
- **CDN**: Global content delivery network for static assets
- **Edge Functions**: Server-side logic at edge locations
- **SSL/TLS**: Automatic HTTPS certificates
- **Build & Deploy**: CI/CD pipeline integration

#### Next.js Framework
- **SSR (Server-Side Rendering)**: Dynamic page generation
- **Routing**: File-based routing system
- **API Routes**: Backend-for-frontend endpoints
- **Static Generation**: Build-time page optimization
- **Code Splitting**: Automatic bundle optimization
- **Image Optimization**: Next.js Image component

### Backend Layer

#### AWS Elastic Beanstalk
- **Container Management**: Docker container orchestration
- **Auto-scaling**: Dynamic instance scaling
- **Load Balancing**: Traffic distribution across instances
- **Health Monitoring**: Instance health checks
- **Rolling Deployments**: Zero-downtime updates
- **Environment Management**: Dev/Staging/Prod isolation

#### Uvicorn ASGI Server
- **ASGI Protocol**: Async server gateway interface
- **WebSocket Support**: Real-time bidirectional communication
- **HTTP/2**: Modern protocol support
- **Worker Management**: Multi-process handling
- **Performance**: High-throughput request handling

#### FastAPI Application
- **REST API**: RESTful endpoint implementation
- **Authentication**: JWT token validation
- **Authorization**: Role-based access control
- **Data Validation**: Pydantic model validation
- **API Documentation**: Auto-generated OpenAPI/Swagger
- **Business Logic**: Core application functionality

### Data Layer

#### AWS RDS PostgreSQL
- **Primary Database**: Persistent data storage
- **Transactions**: ACID compliance
- **Backups**: Automated daily backups
- **Read Replicas**: Read scaling (if configured)
- **High Availability**: Multi-AZ deployment option
- **Schema**: User data, application state, metadata

#### AWS S3
- **Object Storage**: File and asset storage
- **Versioning**: File version control
- **Lifecycle Policies**: Automatic archival
- **CDN Integration**: CloudFront distribution
- **Security**: Bucket policies and encryption
- **Storage Classes**: Cost optimization

#### Redis
- **Session Storage**: User session management
- **Caching**: Response and query caching
- **Rate Limiting**: API throttling
- **Temporary Data**: Short-lived data storage
- **Pub/Sub**: Real-time messaging (optional)

### Communication Layer

#### AWS SES (Simple Email Service)
- **Transactional Emails**: User notifications
- **Email Templates**: Branded email formatting
- **Delivery Tracking**: Bounce and complaint handling
- **SMTP/API**: Multiple sending methods
- **Domain Verification**: SPF/DKIM/DMARC setup

### Development Environment

#### Docker Compose
- **Service Orchestration**: Multi-container management
- **Networking**: Internal container communication
- **Volume Management**: Persistent data storage
- **Environment Isolation**: Consistent dev environment
- **One-Command Setup**: `docker-compose up`

#### Development Services
- **PostgreSQL**: Local database instance
- **Redis**: Local caching instance
- **MinIO**: S3-compatible local storage
- **Mailhog**: Email testing and inspection
- **Hot Reload**: Automatic code reloading

### External Integration

#### qontinui-api
- **ML Processing**: Machine learning model inference
- **Computer Vision**: Image/video analysis
- **Data Processing**: Advanced analytics
- **Async Jobs**: Background task processing
- **API Gateway**: RESTful integration

## Environment Comparison

| Component | Development | Production |
|-----------|------------|------------|
| Frontend | Next.js Dev Server (localhost:3000) | Vercel + CDN (HTTPS) |
| Backend | Uvicorn Dev (localhost:8000) | AWS Elastic Beanstalk + ALB |
| Database | PostgreSQL (Docker) | AWS RDS PostgreSQL |
| Cache | Redis (Docker) | Redis Cloud/ElastiCache |
| Storage | MinIO (Docker) | AWS S3 |
| Email | Mailhog (Docker) | AWS SES |
| ASGI Server | Uvicorn (single worker) | Uvicorn (multi-worker) |
| SSL | None (HTTP) | Automatic (HTTPS) |
| Scaling | Fixed single instance | Auto-scaling instances |
| Monitoring | Console logs | CloudWatch + APM |

## Communication Protocols

### HTTP/HTTPS
- **Frontend to Backend**: REST API calls
- **Backend to RDS**: PostgreSQL wire protocol
- **Backend to S3**: AWS SDK (HTTPS)
- **Backend to SES**: AWS SDK (HTTPS)
- **Backend to qontinui-api**: REST API (HTTPS)

### Redis Protocol
- **Backend to Redis**: Redis protocol (TCP)
- **Frontend to Redis**: Via backend proxy

### WebSocket (Optional)
- **Real-time Updates**: Uvicorn WebSocket support
- **Notifications**: Server-push events

## Security Layers

1. **Edge Security**: Vercel DDoS protection, WAF
2. **Transport**: TLS 1.3 encryption
3. **Authentication**: JWT tokens, OAuth
4. **Authorization**: RBAC policies
5. **Network**: AWS VPC, Security Groups
6. **Data**: Encryption at rest (RDS, S3)
7. **Secrets**: AWS Secrets Manager/Environment variables

## Deployment Flow

### Production Deployment

```mermaid
graph LR
    A[Git Push] --> B[GitHub Actions]
    B --> C{Environment}
    C -->|Frontend| D[Vercel Build]
    C -->|Backend| E[Docker Build]
    D --> F[Vercel Deploy]
    E --> G[AWS EB Deploy]
    F --> H[CDN Invalidation]
    G --> I[Health Check]
    I --> J[Rolling Update]
```

### Development Workflow

```mermaid
graph LR
    A[Code Change] --> B{Service}
    B -->|Frontend| C[Hot Reload]
    B -->|Backend| D[Auto Reload]
    C --> E[Browser Refresh]
    D --> F[Container Restart]
```

## Monitoring & Observability

- **Frontend**: Vercel Analytics, Web Vitals
- **Backend**: AWS CloudWatch, Application logs
- **Database**: RDS Performance Insights
- **Cache**: Redis monitoring metrics
- **APM**: Error tracking (Sentry/DataDog)
- **Logs**: Centralized logging (CloudWatch Logs)

## Disaster Recovery

- **RDS Backups**: Automated daily snapshots
- **S3 Versioning**: Object version history
- **Database Replicas**: Read replicas for failover
- **Multi-Region**: Optional cross-region replication
- **Rollback**: Git-based deployment rollback

## Performance Optimization

- **CDN Caching**: Static asset caching at edge
- **Redis Caching**: Database query caching
- **Connection Pooling**: Database connection reuse
- **Load Balancing**: Horizontal scaling
- **Lazy Loading**: On-demand resource loading
- **Code Splitting**: Reduced bundle sizes
- **Image Optimization**: WebP, responsive images
