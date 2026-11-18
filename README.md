# EJX Logistics

EJX Logistics is a dispatch console for shipments across Malaysia. It runs on Java 21, Spring Boot, and an in-memory H2 database.

## Run locally in Eclipse

1. Set Eclipse to use JDK 21 or later. Go to **File → Import → Maven → Existing Maven Projects** and select the folder with `pom.xml`.
2. Open `LogisticsApplication.java` under `src/main/java/com/example/logistics`.
3. Right-click the class and choose **Run As → Java Application** or **Run As → Spring Boot App** if you have Spring Tools.
4. Wait for `Started LogisticsApplication` in the console, then open [the local application](http://localhost:8080).

Sign in locally with `admin` and `admin123`. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` when running outside your local development environment.

If Eclipse only shows **Run Configurations**, check that you opened the class from the imported Maven project's `src/main/java` source folder.

## Try the demo

The app starts with 12 hubs, a fleet of road vehicles and cargo aircraft, and sample shipments. Use the clock at the top to pause the simulation, change its speed, or skip ahead an hour. **Auto orders** and **Auto dispatch** control what happens as time advances. Restarting the app resets the database and reloads the sample data.

- Use **Overview** to watch trips on the map and review pending shipments or exceptions.
- In **Shipments**, get a quote, book a shipment, check its tracking history, or export the filtered list as a CSV.
- In **Dispatch**, choose a route and assign a vehicle by hand, run automatic dispatch, or track a trip already on the road.
- Check vehicle availability, driver assignments, and maintenance in **Fleet**, or review inbound and outbound counts in **Hubs**.
- Use **Reports** to compare the last 7, 14, or 28 days with the preceding period.

## Dispatch rules

Shipments at the same hub that share a next stop can go on the same vehicle. By default, automatic dispatch looks for a load of at least 60% capacity or a shipment that has waited three hours. Express shipments load first and can trigger dispatch after 90 minutes. If a hub runs out of vehicles, an available vehicle can be moved from a nearby hub.

Cargo aircraft handle cross-sea legs through the configured gateway, which defaults to KUL. Road vehicles stay within Peninsular Malaysia or East Malaysia. Standard delivery is quoted at 48 hours and express at 24 hours, with an extra 24 hours for routes that include air freight.

Shipment and vehicle updates use optimistic locking. Dispatch also locks each hub while assigning shipments and vehicles to prevent double bookings.

## Configuration and tests

Edit `src/main/resources/application.yml` to change the demo setup. Set `app.seed.enabled` or `app.simulation.enabled` to `false` to turn off sample data or the simulation. Dispatch thresholds are under `app.simulation`, and `app.routing.gateway` sets the air gateway.

Run the Java and route tests from the project folder.

```sh
mvn test
node --test src/test/js/map-network.test.mjs
```

## Map data

Map tiles need an internet connection. The app includes simplified freight routes and boundary data from [Natural Earth](https://www.naturalearthdata.com/). Satellite imagery comes from [EOxCloudless](https://cloudless.eox.at/), and street tiles come from [OpenStreetMap](https://www.openstreetmap.org/copyright).
