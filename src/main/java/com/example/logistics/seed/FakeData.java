package com.example.logistics.seed;

import com.example.logistics.hub.Hub;
import com.example.logistics.merchant.Merchant;
import com.example.logistics.shipment.CreateShipmentRequest;
import com.example.logistics.shipment.Priority;

import java.util.List;
import java.util.random.RandomGenerator;

public final class FakeData {
    private static final List<String> GIVEN = List.of(
            "Wei Ming", "Mei Ling", "Ahmad", "Nurul", "Kavitha", "Jun Hao", "Farid", "Siew Lan", "Hafiz", "Pei Shan",
            "Suresh", "Aisyah", "Kok Wai", "Zulkifli", "Hui Min", "Ravi", "Amirul", "Yong Sheng", "Faridah", "Daniel");
    private static final List<String> FAMILY = List.of(
            "Tan", "Lim", "Wong", "Ng", "Lee", "Ong", "Goh", "Chong", "Yap", "Teoh",
            "bin Ismail", "binti Yusof", "bin Hamzah", "a/l Muthu", "a/p Raj", "bin Omar", "binti Ali", "Nair");
    private static final List<String> COMPANIES = List.of(
            "Maju Jaya Trading", "Sinar Elektrik Sdn Bhd", "Harmoni Perabot", "Kedai Runcit Hock Seng",
            "Global Parts Supply", "Nusantara Foods", "Tech Hub Gadgets", "Evergreen Agro", "Pantai Seafood Supply",
            "Sri Murni Textiles", "Golden Rice Mill", "Borneo Craft Co.", "Cahaya Pharmacy", "Mega Hardware",
            "Delima Cosmetics", "Kopi Kampung Roasters");
    private static final List<String> STREETS = List.of(
            "Jalan Bunga Raya", "Jalan Merdeka", "Jalan Ampang", "Jalan Sultan", "Jalan Mawar", "Jalan Kenanga",
            "Jalan Cempaka", "Jalan Industri", "Jalan Perdana", "Lorong Damai", "Jalan Setia", "Jalan Harmoni");
    private static final List<String> DRIVERS = List.of(
            "Ahmad Faizal", "Tan Wei Ming", "Muthu Raj", "Lim Chee Keong", "Nurul Huda", "Wong Kah Leong",
            "Mohd Hafiz", "Siva Kumar", "Chong Mei Ling", "Lee Jun Hao", "Farid Ismail", "Kavitha Devi",
            "Ong Boon Hock", "Hairul Anuar", "Goh Siew Lan", "Rizal Hamzah", "Yap Kok Wai", "Zulkifli Omar",
            "Chan Ah Kow", "Hamidah Yusof", "Ravi Chandran", "Teoh Seng Huat", "Amirul Hakim", "Ng Pei Shan",
            "Daniel Lau", "Faridah Ali", "Suresh Nair", "Kamal Ariffin", "Foo Yong Sheng", "Aisyah Rahman");

    private FakeData() {
    }

    public static List<String> companies() {
        return COMPANIES;
    }

    public static Merchant pickMerchant(List<Merchant> merchants, RandomGenerator rnd) {
        return pick(merchants, rnd);
    }

    public static Hub originFor(Merchant merchant, List<Hub> hubs, RandomGenerator rnd) {
        return rnd.nextDouble() < 0.75 ? merchant.getDefaultHub() : weightedHub(hubs, null, rnd);
    }

    public static CreateShipmentRequest randomOrder(Merchant merchant, List<Hub> hubs, RandomGenerator rnd) {
        Hub origin = originFor(merchant, hubs, rnd);
        Hub destination = weightedHub(hubs, origin, rnd);
        return new CreateShipmentRequest(origin.getId(), destination.getId(), null, person(rnd), phone(rnd),
                address(destination, rnd), weightKg(rnd), priority(rnd), merchant.getId());
    }

    public static String person(RandomGenerator rnd) {
        String family = pick(FAMILY, rnd);
        String given = pick(GIVEN, rnd);
        return family.startsWith("bin") || family.startsWith("binti") || family.startsWith("a/") || family.equals("Nair")
                ? given + " " + family
                : family + " " + given;
    }

    public static String company(RandomGenerator rnd) {
        return pick(COMPANIES, rnd);
    }

    public static String driver(int index) {
        return DRIVERS.get(index % DRIVERS.size());
    }

    public static String phone(RandomGenerator rnd) {
        return String.format("01%d-%03d %04d", rnd.nextInt(0, 10), rnd.nextInt(100, 1000), rnd.nextInt(0, 10_000));
    }

    public static String address(Hub hub, RandomGenerator rnd) {
        return "No. " + rnd.nextInt(1, 200) + ", " + pick(STREETS, rnd) + " " + rnd.nextInt(1, 30) + ", "
                + hub.getName().replace(" Distribution Centre", "").replace(" Hub", "") + ", " + hub.getState();
    }

    public static double weightKg(RandomGenerator rnd) {
        double roll = rnd.nextDouble();
        double kg;
        if (roll < 0.55) {
            kg = rnd.nextDouble(2, 60);
        } else if (roll < 0.9) {
            kg = rnd.nextDouble(60, 400);
        } else {
            kg = rnd.nextDouble(400, 1500);
        }
        return Math.round(kg * 10) / 10.0;
    }

    public static Priority priority(RandomGenerator rnd) {
        return rnd.nextDouble() < 0.25 ? Priority.EXPRESS : Priority.STANDARD;
    }

    public static Hub weightedHub(List<Hub> hubs, Hub exclude, RandomGenerator rnd) {
        int total = 0;
        for (Hub h : hubs) {
            if (!h.sameAs(exclude)) {
                total += Math.max(1, h.getDemandWeight());
            }
        }
        int roll = rnd.nextInt(total);
        for (Hub h : hubs) {
            if (h.sameAs(exclude)) {
                continue;
            }
            roll -= Math.max(1, h.getDemandWeight());
            if (roll < 0) {
                return h;
            }
        }
        throw new IllegalStateException("no hub picked");
    }


    public static <T> T pick(List<T> list, RandomGenerator rnd) {
        return list.get(rnd.nextInt(list.size()));
    }
}
