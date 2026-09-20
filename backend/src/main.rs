use axum::http::{header, Method};
use std::sync::Arc;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod auth;
mod config;
mod database;
mod errors;
mod jobs;
mod media;
mod models;
mod security;
mod storage;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "ownmediahost_backend=debug,tower_http=debug,axum=trace".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting OwnMediaHost personal media platform backend...");

    // Load configuration
    let config = config::AppConfig::from_env();
    info!("Configuration loaded. Environment: {}", config.app_env);

    // Initialize Database
    let pool = database::init_db(&config).await?;

    // Initialize Storage
    let storage = storage::LocalStorageProvider::new(config.media_root.clone())?;

    let config_arc = Arc::new(config);

    // Start background job worker
    jobs::spawn_job_worker(pool.clone(), storage.clone(), config_arc.clone());

    // Configure CORS
    let cors = CorsLayer::new()
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
            Method::HEAD,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            header::RANGE,
            header::ORIGIN,
            header::COOKIE,
            header::ACCESS_CONTROL_REQUEST_METHOD,
            header::ACCESS_CONTROL_REQUEST_HEADERS,
            header::HeaderName::from_static("x-request-id"),
            header::HeaderName::from_static("x-api-key"),
        ])
        .allow_credentials(true)
        .allow_origin(AllowOrigin::predicate({
            let allowed_origins = config_arc.allowed_origins.clone();
            move |origin, _| {
                let origin_str = match origin.to_str() {
                    Ok(s) => s,
                    Err(_) => return false,
                };

                // Direct match or wildcard
                if allowed_origins.iter().any(|o| {
                    o == "*"
                        || o == origin_str
                        || origin_str.trim_end_matches('/') == o.trim_end_matches('/')
                }) {
                    return true;
                }

                let clean_orig = origin_str
                    .trim_start_matches("https://")
                    .trim_start_matches("http://")
                    .trim_end_matches('/');

                // Localhost / loopback check
                if clean_orig.starts_with("localhost") || clean_orig.starts_with("127.0.0.1") {
                    return true;
                }

                // Domain & subdomain matching
                allowed_origins.iter().any(|o| {
                    let clean_o = o
                        .trim_start_matches("https://")
                        .trim_start_matches("http://")
                        .trim_end_matches('/');
                    if clean_o.is_empty() {
                        return false;
                    }
                    if clean_o == clean_orig {
                        return true;
                    }
                    // Subdomain match (e.g. media.domain.com matching domain.com)
                    if clean_orig.ends_with(&format!(".{}", clean_o)) {
                        return true;
                    }
                    // Sister subdomain match (e.g. media.domain.com and api.domain.com sharing domain.com)
                    let parts_o: Vec<&str> = clean_o.split('.').collect();
                    let parts_orig: Vec<&str> = clean_orig.split('.').collect();
                    if parts_o.len() >= 2 && parts_orig.len() >= 2 {
                        let apex_o = format!("{}.{}", parts_o[parts_o.len() - 2], parts_o[parts_o.len() - 1]);
                        let apex_orig = format!("{}.{}", parts_orig[parts_orig.len() - 2], parts_orig[parts_orig.len() - 1]);
                        if apex_o == apex_orig {
                            return true;
                        }
                    }
                    false
                })
            }
        }));

    // Build Axum router
    let app = api::create_router(pool.clone(), storage.clone(), config_arc.clone())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(axum::Extension(pool))
        .layer(axum::Extension(config_arc.clone()));

    let bind_addr = format!("{}:{}", config_arc.host, config_arc.port);
    info!("OwnMediaHost server listening on http://{}", bind_addr);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    info!("OwnMediaHost server gracefully stopped.");
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

