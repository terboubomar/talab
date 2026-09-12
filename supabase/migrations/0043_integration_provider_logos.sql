-- TALAB marketplace provider logos.
-- Every integration provider shown in the App Marketplace must have a brand logo.

update public.integration_providers
set logo = case slug
  when 'foodics' then 'https://www.foodics.com/wp-content/uploads/2022/02/foodics-logo-grey-3.svg'
  when 'odoo' then 'https://odoocdn.com/openerp_website/static/src/img/assets/svg/odoo_logo.svg'
  else logo
end
where slug in ('foodics', 'odoo');

-- Make the requirement permanent for every provider added from this point forward.
alter table public.integration_providers
  drop constraint if exists integration_providers_logo_required;

alter table public.integration_providers
  add constraint integration_providers_logo_required
  check (logo is not null and length(trim(logo)) > 0);
