BEGIN;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  timezone text NOT NULL DEFAULT 'Asia/Jakarta',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_subject text NOT NULL UNIQUE,
  email text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,user_id)
);

CREATE TABLE apps (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  name text NOT NULL,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,key)
);

CREATE TABLE app_versions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  version_no integer NOT NULL CHECK (version_no > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  definition jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(definition) = 'object'),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,app_id,id),
  UNIQUE (tenant_id,app_id,version_no),
  FOREIGN KEY (tenant_id,app_id) REFERENCES apps(tenant_id,id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
  CHECK ((status = 'draft' AND published_at IS NULL) OR (status = 'published' AND published_at IS NOT NULL))
);

CREATE UNIQUE INDEX one_draft_per_app ON app_versions(tenant_id,app_id) WHERE status = 'draft';
ALTER TABLE apps ADD CONSTRAINT app_current_version_fk
  FOREIGN KEY (tenant_id,id,current_version_id) REFERENCES app_versions(tenant_id,app_id,id);

CREATE FUNCTION guard_published_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'Published metadata is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER published_version_immutable BEFORE UPDATE OR DELETE ON app_versions
  FOR EACH ROW EXECUTE FUNCTION guard_published_version();

CREATE FUNCTION guard_current_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app_versions v WHERE v.tenant_id = NEW.tenant_id
      AND v.app_id = NEW.id AND v.id = NEW.current_version_id AND v.status = 'published'
  ) THEN
    RAISE EXCEPTION 'Current version must be published in the same app' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER app_current_version_published BEFORE INSERT OR UPDATE OF current_version_id ON apps
  FOR EACH ROW EXECUTE FUNCTION guard_current_version();

CREATE TABLE records (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  schema_version_id uuid NOT NULL,
  entity_key text NOT NULL CHECK (entity_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  owner_id uuid NOT NULL,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,app_id,id),
  FOREIGN KEY (tenant_id,app_id) REFERENCES apps(tenant_id,id),
  FOREIGN KEY (tenant_id,app_id,schema_version_id) REFERENCES app_versions(tenant_id,app_id,id),
  FOREIGN KEY (tenant_id,owner_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,created_by) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,updated_by) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX record_list_idx ON records(tenant_id,app_id,entity_key,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE INDEX record_owner_idx ON records(tenant_id,owner_id,app_id,entity_key) WHERE deleted_at IS NULL;
CREATE INDEX record_data_gin_idx ON records USING gin(data jsonb_path_ops);

CREATE TABLE record_links (
  tenant_id uuid NOT NULL,
  app_id uuid NOT NULL,
  source_record_id uuid NOT NULL,
  field_key text NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  target_record_id uuid NOT NULL,
  PRIMARY KEY (tenant_id,source_record_id,field_key),
  FOREIGN KEY (tenant_id,app_id,source_record_id) REFERENCES records(tenant_id,app_id,id),
  FOREIGN KEY (tenant_id,app_id,target_record_id) REFERENCES records(tenant_id,app_id,id),
  CHECK (source_record_id <> target_record_id)
);
CREATE INDEX record_link_target_idx ON record_links(tenant_id,target_record_id);

CREATE TABLE workflow_runs (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  app_id uuid NOT NULL,
  record_id uuid NOT NULL,
  app_version_id uuid NOT NULL,
  workflow_key text NOT NULL,
  trigger_key text NOT NULL,
  started_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_approval','completed','failed','conflict','canceled')),
  cursor text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,app_id,trigger_key),
  FOREIGN KEY (tenant_id,app_id,record_id) REFERENCES records(tenant_id,app_id,id),
  FOREIGN KEY (tenant_id,app_id,app_version_id) REFERENCES app_versions(tenant_id,app_id,id),
  FOREIGN KEY (tenant_id,started_by) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX workflow_status_idx ON workflow_runs(tenant_id,status,created_at);
CREATE INDEX workflow_record_idx ON workflow_runs(tenant_id,record_id,status);

CREATE TABLE approval_tasks (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  node_key text NOT NULL,
  assignee_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','canceled')),
  decided_by uuid,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,run_id,node_key),
  FOREIGN KEY (tenant_id,run_id) REFERENCES workflow_runs(tenant_id,id),
  FOREIGN KEY (tenant_id,assignee_id) REFERENCES memberships(tenant_id,user_id),
  FOREIGN KEY (tenant_id,decided_by) REFERENCES memberships(tenant_id,user_id),
  CHECK ((status = 'pending' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status IN ('approved','rejected','canceled') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)),
  CHECK (status <> 'rejected' OR length(trim(coalesce(decision_note,''))) > 0),
  CHECK (status NOT IN ('approved','rejected') OR decided_by = assignee_id)
);
CREATE INDEX approval_inbox_idx ON approval_tasks(tenant_id,assignee_id,status,created_at);

CREATE TABLE notifications (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,dedupe_key),
  FOREIGN KEY (tenant_id,recipient_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX notification_inbox_idx ON notifications(tenant_id,recipient_id,created_at DESC);

CREATE TABLE outbox_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','dead')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lease_token uuid,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  UNIQUE (tenant_id,event_key),
  CHECK ((status = 'processing' AND locked_at IS NOT NULL AND lease_token IS NOT NULL)
    OR (status <> 'processing' AND locked_at IS NULL AND lease_token IS NULL))
);
CREATE INDEX outbox_pending_idx ON outbox_events(available_at,tenant_id,id) WHERE status = 'pending';
CREATE INDEX outbox_lease_idx ON outbox_events(locked_at) WHERE status = 'processing';

CREATE TABLE audit_events (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  changes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(changes) = 'object'),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,id),
  FOREIGN KEY (tenant_id,actor_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE INDEX audit_time_idx ON audit_events(tenant_id,created_at DESC);

CREATE FUNCTION context_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id',true),'')::uuid
$$;
CREATE FUNCTION context_user() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id',true),'')::uuid
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['memberships','apps','app_versions','records','record_links','workflow_runs','approval_tasks','outbox_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',table_name);
    EXECUTE format('CREATE POLICY tenant_boundary ON %I FOR ALL USING (tenant_id = context_tenant()) WITH CHECK (tenant_id = context_tenant())',table_name);
  END LOOP;
END;
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON tenants FOR SELECT USING (id = context_tenant());

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_read ON notifications FOR SELECT
  USING (tenant_id = context_tenant() AND recipient_id = context_user());
CREATE POLICY notification_update ON notifications FOR UPDATE
  USING (tenant_id = context_tenant() AND recipient_id = context_user())
  WITH CHECK (tenant_id = context_tenant() AND recipient_id = context_user());
CREATE POLICY notification_insert ON notifications FOR INSERT WITH CHECK (tenant_id = context_tenant());

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_events FOR SELECT USING (tenant_id = context_tenant());
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (tenant_id = context_tenant());

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

REVOKE ALL ON tenants,users,memberships,apps,app_versions,records,record_links,workflow_runs,approval_tasks,notifications,outbox_events,audit_events FROM PUBLIC;
REVOKE ALL ON FUNCTION guard_published_version(),guard_current_version(),context_tenant(),context_user() FROM PUBLIC;

COMMIT;
