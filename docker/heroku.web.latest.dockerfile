FROM python:3.8.13-slim-bullseye

# Sane defaults for pip
ENV \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Sentry config params
    SENTRY_CONF=/etc/sentry \
    # Disable some unused uWSGI features, saving dependencies
    # Thank to https://stackoverflow.com/a/25260588/90297
    UWSGI_PROFILE_OVERRIDE=ssl=false;xml=false;routing=false \
    # UWSGI dogstatsd plugin
    UWSGI_NEED_PLUGIN=/var/lib/uwsgi/dogstatsd \
    # grpcio>1.30.0 requires this, see requirements.txt for more detail.
    GRPC_POLL_STRATEGY=epoll1

COPY ./requirements-frozen.txt /tmp/requirements-frozen.txt

RUN set -x \
    && buildDeps="" \
    # uwsgi
    && buildDeps="$buildDeps \
    gcc \
    wget \
    " \
    # psycopg2-binary
    && buildDeps="$buildDeps \
    libpq-dev \
    " \
    # maxminddb
    && buildDeps="$buildDeps \
    libmaxminddb-dev \
    "\
    # xmlsec
    && buildDeps="$buildDeps \
    libxmlsec1-dev \
    pkg-config \
    " \
    && apt-get update \
    && apt-get install -y --no-install-recommends $buildDeps \
    && pip install -r /tmp/requirements-frozen.txt \
    && mkdir /tmp/uwsgi-dogstatsd \
    && wget -O - https://github.com/eventbrite/uwsgi-dogstatsd/archive/filters-and-tags.tar.gz | \
    tar -xzf - -C /tmp/uwsgi-dogstatsd --strip-components=1 \
    && UWSGI_NEED_PLUGIN="" uwsgi --build-plugin /tmp/uwsgi-dogstatsd \
    && mkdir -p /var/lib/uwsgi \
    && mv dogstatsd_plugin.so /var/lib/uwsgi/ \
    && rm -rf /tmp/requirements-frozen.txt /tmp/uwsgi-dogstatsd .uwsgi_plugins_builder \
    && apt-get purge -y --auto-remove $buildDeps \
    # We install run-time dependencies strictly after
    # build dependencies to prevent accidental collusion.
    # These are also installed last as they are needed
    # during container run and can have the same deps w/
    # build deps such as maxminddb.
    && apt-get install -y --no-install-recommends \
    # pillow
    libjpeg-dev \
    # rust bindings
    libffi-dev \
    # maxminddb bindings
    libmaxminddb-dev \
    # SAML needs these run-time
    libxmlsec1-dev \
    libxslt-dev \
    # pyyaml needs this run-time
    libyaml-dev \
    # other
    pkg-config \
    \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    # Fully verify that the C extension is correctly installed, it unfortunately
    # requires a full check into maxminddb.extension.Reader
    && python -c 'import maxminddb.extension; maxminddb.extension.Reader' \
    && mkdir -p $SENTRY_CONF

COPY ./docker/sentry.conf.py ./docker/config.yml $SENTRY_CONF/
COPY ./docker/docker-entrypoint.sh /
ENTRYPOINT exec /docker-entrypoint.sh "$0" "$@"
# Heroku use $PORT, thus, it will overwrite this
ENV PORT="8000"

CMD sentry run web --bind 0.0.0.0:$PORT