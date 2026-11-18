# EJX Logistics

EJX Logistics is a Java 21 and Spring Boot operations console for shipping, dispatch, fleet management, and parcel tracking across Malaysia. Access requires an administrator account.

The local simulation seeds 12 hubs, a fleet of road vehicles and cargo aircraft, and sample shipments. It can create orders, dispatch vehicles, and update trip positions as the simulation clock advances.

The demo includes assigned drivers, vehicle features, service dates, and example fuel scores. In Fleet, operators can enter available details when adding a vehicle. The dashboard classifies road vehicles with at least 5,000 kg of payload capacity as heavy.

## Run locally in Eclipse

1. Use JDK 21 or later. Select **File → Import → Maven → Existing Maven Projects** and choose the directory containing `pom.xml`.
2. Open `src/main/java/com/example/logistics/LogisticsApplication.java`.
3. Right-click the class and select **Run As → Java Application**. Spring Tools users can select **Run As → Spring Boot App**.
4. Once the console shows `Started LogisticsApplication`, open [the local application](http://localhost:8080).

The local administrator account is `admin` with password `admin123`. These defaults are for local development. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` for other environments.

If Eclipse only offers **Run Configurations**, verify that the file sits under the imported Maven project's `src/main/java` source folder. The application uses an in-memory H2 database, so restarting it resets the demo data.

## Features

| Area | Features |
| --- | --- |
| Overview | Malaysia freight map, shipment directions, top routes, operational metrics, pending shipments, and live trip tracking |
| Shipments | Quotes, order creation, filters, tracking history, exception handling, delivery confirmation, and CSV export |
| Dispatch | Manual dispatch, automatic load consolidation, empty vehicle relocation, and active trip progress |
| Fleet and hubs | Vehicle availability and maintenance, vehicle and hub registration, and inbound and outbound shipment counts |
| Reports | Shipment, delivery, and revenue trends compared with the prior period, with hub rankings and shipment directions |

## Dispatch rules

- Shipments with the same origin hub and next stop can share a vehicle. The default dispatch threshold is 60% capacity or three hours of waiting, reduced to 90 minutes for express shipments. Express shipments load first.
- Cross-sea shipments connect by road and cargo aircraft through the configured gateway. Road vehicles stay within Peninsular Malaysia or East Malaysia. The default gateway is KUL.
- When a hub needs a vehicle, the dispatcher can relocate an available vehicle from a nearby hub.
- Standard delivery is 48 hours and express delivery is 24 hours. Air routes add 24 hours. Pricing starts at RM 10, adds a distance-based charge per kilogram, and applies express and air multipliers when applicable.
- Shipment and vehicle changes use optimistic locking. Per-hub locks prevent concurrent dispatches from assigning the same shipment or vehicle twice.

## Configuration and tests

Application settings live in `src/main/resources/application.yml`. Use `app.seed.enabled` and `app.simulation.enabled` to disable demo data and simulation. Dispatch thresholds live under `app.simulation`, and the air gateway is set by `app.routing.gateway`.

```sh
mvn test
node --test src/test/js/map-network.test.mjs
```

The dashboard receives live events from `/api/live`. The frontend sends the `X-XSRF-TOKEN` header with the matching cookie value for write requests.

## Map data

The map uses [EOxCloudless](https://cloudless.eox.at/) satellite imagery with [OpenStreetMap](https://www.openstreetmap.org/copyright) fallback tiles. Tiles need a network connection. [Natural Earth](https://www.naturalearthdata.com/) boundary data and simplified freight route geometry are included in the application.
