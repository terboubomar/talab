-- TALAB Marketplace — OneSignal provider.
-- Adds OneSignal as a configurable communications provider for OTP SMS,
-- transactional SMS, and push notifications. Actual OTP delivery remains
-- disabled until credentials and the Supabase Send SMS Auth Hook are wired.

insert into public.integration_providers (
  slug,
  category,
  name_ar,
  name_en,
  logo,
  config_schema,
  active
)
values (
  'onesignal',
  'sms',
  'ون سيجنال',
  'OneSignal',
  'https://cdn.simpleicons.org/onesignal/E54B4D',
  jsonb_build_object(
    'credential_mode','vault',
    'capabilities',jsonb_build_array('sms_otp','transactional_sms','push_notifications'),
    'description_ar','إرسال رموز التحقق OTP والرسائل النصية التشغيلية وإشعارات Push عبر OneSignal.',
    'description_en','Deliver OTP SMS, transactional SMS, and push notifications through OneSignal.',
    'auth_integration','supabase_send_sms_hook',
    'connection_status','requires_credentials_and_hook',
    'developer_docs_url','https://documentation.onesignal.com/reference/create-message',
    'sms_setup_url','https://documentation.onesignal.com/docs/en/sms-setup'
  ),
  true
)
on conflict (slug) do update set
  category = excluded.category,
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  logo = excluded.logo,
  config_schema = excluded.config_schema,
  active = excluded.active;
