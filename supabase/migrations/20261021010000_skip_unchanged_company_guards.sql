begin;

-- Keep cross-module checks when any of their inputs change, not on contract saves.
drop trigger guard_inventory on public.company_data;
create trigger guard_inventory before update on public.company_data
for each row when (
  old.payload->'inventory' is distinct from new.payload->'inventory'
  or old.payload->'movements' is distinct from new.payload->'movements'
  or old.payload->'products' is distinct from new.payload->'products'
  or old.payload->'orders' is distinct from new.payload->'orders'
  or old.payload#>'{finance,purchasing,orders}' is distinct from new.payload#>'{finance,purchasing,orders}'
) execute function public.guard_inventory();
create trigger guard_inventory_insert_delete before insert or delete on public.company_data
for each row execute function public.guard_inventory();

drop trigger guard_purchase_approvals on public.company_data;
create trigger guard_purchase_approvals before update on public.company_data
for each row when (
  old.payload#>'{finance,purchasing,orders}' is distinct from new.payload#>'{finance,purchasing,orders}'
) execute function public.guard_purchase_approvals();
create trigger guard_purchase_approvals_insert_delete before insert or delete on public.company_data
for each row execute function public.guard_purchase_approvals();

drop trigger guard_purchase_return_finance on public.company_data;
create trigger guard_purchase_return_finance before update on public.company_data
for each row when (
  old.payload#>'{inventory,purchaseReturns}' is distinct from new.payload#>'{inventory,purchaseReturns}'
  or old.payload#>'{finance,purchasing,orders}' is distinct from new.payload#>'{finance,purchasing,orders}'
  or old.payload#>'{finance,entries}' is distinct from new.payload#>'{finance,entries}'
) execute function public.guard_purchase_return_finance();
create trigger guard_purchase_return_finance_insert_delete before insert or delete on public.company_data
for each row execute function public.guard_purchase_return_finance();

commit;
