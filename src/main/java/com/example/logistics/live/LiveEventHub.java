package com.example.logistics.live;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.http.MediaType;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionHandler;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Component
public class LiveEventHub implements DisposableBean {
    private static final Logger log = LoggerFactory.getLogger(LiveEventHub.class);
    private static final long EMITTER_TIMEOUT_MS = Duration.ofMinutes(30).toMillis();
    private static final int QUEUE_CAPACITY = 2_000;
    private static final int RECENT_LIMIT = 40;

    private final Set<SseEmitter> emitters = ConcurrentHashMap.newKeySet();
    private final Deque<LiveEvent> recent = new ArrayDeque<>();
    private final ThreadPoolExecutor sender;
    private final Counter dropped;
    private final Counter published;

    public LiveEventHub(MeterRegistry registry) {
        this.dropped = Counter.builder("live.events.dropped").register(registry);
        this.published = Counter.builder("live.events.published").register(registry);
        Gauge.builder("live.subscribers", emitters, Set::size).register(registry);

        RejectedExecutionHandler dropOldest = (task, executor) -> {
            if (executor.isShutdown()) {
                return;
            }
            executor.getQueue().poll();
            dropped.increment();
            executor.execute(task);
        };
        this.sender = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(QUEUE_CAPACITY), r -> {
            Thread t = new Thread(r, "sse-sender");
            t.setDaemon(true);
            return t;
        }, dropOldest);
    }

    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(EMITTER_TIMEOUT_MS);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> {
            emitters.remove(emitter);
            emitter.complete();
        });
        emitter.onError(e -> emitters.remove(emitter));
        emitters.add(emitter);
        sender.execute(() -> send(emitter, SseEmitter.event().name("hello").data("connected")));
        return emitter;
    }

    public void publish(LiveEvent event) {
        synchronized (recent) {
            recent.addFirst(event);
            while (recent.size() > RECENT_LIMIT) {
                recent.removeLast();
            }
        }
        published.increment();
        sender.execute(() -> broadcast(event));
    }

    public void publishAfterCommit(LiveEvent event) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    publish(event);
                }
            });
        } else {
            publish(event);
        }
    }

    public List<LiveEvent> recent() {
        synchronized (recent) {
            return new ArrayList<>(recent);
        }
    }

    public int subscribers() {
        return emitters.size();
    }

    @Scheduled(fixedRate = 15_000, initialDelay = 15_000)
    void heartbeat() {
        sender.execute(() -> {
            for (SseEmitter emitter : emitters) {
                send(emitter, SseEmitter.event().comment("ping"));
            }
        });
    }

    private void broadcast(LiveEvent event) {
        for (SseEmitter emitter : emitters) {
            send(emitter, SseEmitter.event().name(event.type()).data(event, MediaType.APPLICATION_JSON));
        }
    }

    private void send(SseEmitter emitter, SseEmitter.SseEventBuilder event) {
        try {
            emitter.send(event);
        } catch (IOException | IllegalStateException e) {
            emitters.remove(emitter);
            log.debug("dropping SSE subscriber: {}", e.toString());
            try {
                emitter.complete();
            } catch (RuntimeException ignored) {
            }
        }
    }

    @Override
    public void destroy() {
        sender.shutdownNow();
        for (SseEmitter emitter : emitters) {
            try {
                emitter.complete();
            } catch (RuntimeException ignored) {
            }
        }
        emitters.clear();
    }
}
