# Sales Dashboard Export Package

This package contains the complete source code, database dump, and documentation for the Sales Dashboard project. It is designed to be handed off to another AI agent (like Claude, Manus, or a developer) to continue development, deploy, or extend.

## 1. Project Architecture & Tech Stack

The project is a full-stack web application built with a modern React/Node.js stack.

*   **Frontend:** React 19, Tailwind CSS 4, shadcn/ui, Recharts (for visualizations), Wouter (routing).
*   **Backend:** Node.js, Express, tRPC 11 (strongly typed API), SuperJSON.
*   **Database:** MySQL/TiDB (managed via Drizzle ORM).
*   **Authentication:** Manus OAuth (handles user sessions and roles).
*   **Hosting:** Node.js server-side rendering, deployable to Cloud Run (Autoscale) or any Node-compatible host.

### Folder Structure

```
sales-dashboard/
├── client/             # React frontend
│   ├── src/
│   │   ├── pages/      # Page components (Dashboard, Upload, etc.)
│   │   ├── components/ # UI components (shadcn, charts, layouts)
│   │   ├── hooks/      # Custom React hooks
│   │   └── lib/        # Utilities and tRPC client
├── server/             # Node.js backend
│   ├── routers.ts      # tRPC API definitions (entry point)
│   ├── db.ts           # Database queries and business logic
│   ├── storage.ts      # S3 file storage helpers
│   └── _core/          # Framework internals (auth, env, context)
├── drizzle/            # Database schema and migrations
│   ├── schema.ts       # Table definitions
│   └── migrations/     # Generated SQL migrations
├── shared/             # Shared types and constants
├── database-dump.sql   # Full database backup (schema + data)
└── package.json        # Dependencies and scripts
```

## 2. Data Pipeline & Business Logic

The core functionality of the dashboard revolves around importing sales data from Shopee and Lazada Excel exports and aggregating it for analysis.

### Excel Import Logic (`server/routers.ts`)
The `importExcelData` function handles parsing raw Excel buffers into structured database rows.

1.  **Shopee Files:**
    *   Identified by filenames matching the `Order.all.YYYYMMDD_YYYYMMDD.xlsx` pattern.
    *   Extracts columns: Platform, Order Date, Product Name, Unit Price, Quantity, Subtotal.
    *   Brand is extracted using `extractBrandFromName()`.
    *   Each row represents a line item on an order.
2.  **Lazada Files:**
    *   Identified by filenames that do not match the Shopee pattern (usually UUID-named files).
    *   Extracts columns: Order Date, Product Name, Paid Price.
    *   **Crucial Rule:** Each row in a Lazada file represents exactly 1 unit (Quantity = 1).

### Shop Assignment
*   Every imported order is tagged with a `shop` value: `"Japan Stationery"` or `"Elite Camp"`.
*   The shop assignment is determined by the user selecting the shop in the Upload UI dropdown before uploading the file.
*   Existing legacy data has been backfilled to `"Japan Stationery"`.

### Brand Mapping & Product Name Shortening (`server/db.ts`)

The system enforces strict brand mapping to ensure consistent charting:
*   **Uni:** "Mitsubishi", "Mitsu", "Uni", "Uni-ball", "Uniball" are all unified under the brand `"Uni"`.
*   **Olight Dual Attribution:** "Olight" products appear in both shops. The dashboard groups them together in the "Sales by Brand" view regardless of which shop sold them, but keeps them separate in the "Sales by Platform" (grouped stacked bar) view.

The `shortenProductName` function cleans up cluttered Excel product names into readable labels for the charts:
*   Removes common SEO filler words (e.g., "Free Shipping", "Ready Stock").
*   Extracts key model codes (e.g., PG513, SN-108).
*   Normalizes brand names within the string.

## 3. Database Schema

The database uses MySQL/TiDB with two primary tables:

**`sales_orders`**
*   `id` (int, PK)
*   `platform` (enum: 'Shopee', 'Lazada')
*   `shop` (enum: 'Japan Stationery', 'Elite Camp')
*   `orderDate` (varchar, formatted as YYYY-MM-DD)
*   `productName` (text)
*   `brand` (varchar)
*   `unitPrice` (decimal)
*   `quantity` (int)
*   `subtotal` (decimal)
*   `sourceFile` (varchar, original Excel filename)
*   `createdAt` (timestamp)

**`uploaded_files`**
*   `id` (int, PK)
*   `fileUrl`, `fileKey`, `originalName`, `mimeType`, `fileSize`
*   `shop` (enum: 'Japan Stationery', 'Elite Camp')
*   `importStatus` (enum: 'pending', 'importing', 'imported', 'failed')
*   `ordersImported` (int)
*   `uploadedBy` (int, foreign key to user)

## 4. Dashboard Features

The React frontend (`client/src/pages/Dashboard.tsx`) provides a comprehensive view of the sales data.

1.  **Global Filters:**
    *   Date range (From / To).
    *   Platform (All / Shopee / Lazada).
    *   Brand (All / Specific Brands).
    *   **Shop** (All / Japan Stationery / Elite Camp).
2.  **Quick Filters:** Buttons for specific years (2023-2026) and rolling periods (Last 1, 3, 6 months).
3.  **Sales by Shop & Platform (Grouped Stacked Bar Chart):**
    *   Displays side-by-side bars for each time period.
    *   Left bar: Japan Stationery (stacked Shopee bottom, Lazada top).
    *   Right bar: Elite Camp (stacked Shopee bottom, Lazada top).
    *   Supports Monthly and Yearly toggle views.
4.  **Sales by Brand (Bar Chart):**
    *   Shows total sales per brand.
    *   **Olight Exception:** Combines Olight sales from both shops into a single bar.
5.  **Top 50 Tables:**
    *   Sortable tables for Top Items by Quantity and Top Items by Sales Value.
    *   Uses the shortened, cleaned-up product names.

## 5. Setup & Local Development

To run this project locally after unzipping:

1.  **Install Dependencies:**
    ```bash
    npm install
    ```
2.  **Environment Variables:**
    Create a `.env` file in the root directory with the following variables (you will need to replace the placeholders with your actual credentials, especially the database URL):
    ```env
    DATABASE_URL=mysql://user:password@host:3306/dbname
    JWT_SECRET=your_jwt_secret
    OAUTH_SERVER_URL=your_oauth_url
    VITE_APP_ID=your_app_id
    VITE_FRONTEND_FORGE_API_URL=your_forge_url
    VITE_FRONTEND_FORGE_API_KEY=your_forge_key
    BUILT_IN_FORGE_API_URL=your_forge_url
    BUILT_IN_FORGE_API_KEY=your_forge_key
    ```
3.  **Load Database:**
    Import the provided SQL dump into your local MySQL/TiDB database:
    ```bash
    mysql -u user -p dbname < database-dump.sql
    ```
4.  **Start Development Server:**
    ```bash
    npm run dev
    ```
    The app will be available at `http://localhost:3000`.

## 6. Deployment

The project is designed to be deployed as a Node.js web server.
*   **Hosting:** Cloud Run, Render, Railway, or any standard Node.js host.
*   **Build:** Run `npm run build` to compile the frontend and backend.
*   **Start:** Run `node dist/server/_core/index.js` (or the equivalent production start script defined in `package.json`).
*   **Database:** Ensure your production environment variable `DATABASE_URL` points to a managed MySQL/TiDB instance.

---

## 7. Prompt for Claude (or other AI)

If you are handing this off to Claude or another AI agent to continue development, copy and paste the following prompt:

> "I am providing a complete export of a Sales Dashboard project. The source code is in `sales-dashboard-src` and the database dump is `database-dump.sql`.
>
> **Current State:**
> The app is a React + Node.js + tRPC dashboard that tracks Shopee and Lazada sales for two shops: 'Japan Stationery' and 'Elite Camp'. It imports Excel files, extracts brands (unifying Mitsubishi to Uni), and shortens product names. The main dashboard features a grouped stacked bar chart comparing the two shops side-by-side (stacked by Shopee/Lazada).
>
> **Task:**
> [Insert your specific request here, e.g., "Add a new feature to export the filtered data as a PDF report", or "Fix a bug where the Lazada import incorrectly parses quantity", or "Add a new page for inventory management".]
>
> **Instructions:**
> 1. Read the `README.md` to understand the architecture and business logic.
> 2. Modify the necessary files in `sales-dashboard-src`.
> 3. If you change the database schema, update `drizzle/schema.ts` and generate a new migration.
> 4. Ensure all TypeScript types are correct and the UI follows the existing shadcn/ui + Tailwind styling."
