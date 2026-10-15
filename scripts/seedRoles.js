const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const ROLES = {
  admin: {
    name: 'admin',
    description: 'Full system access — all permissions',
    permissions: '*',
  },
  manager: {
    name: 'manager',
    description: 'Operational manager — full banquet operations access',
    permissions: [
      'view_dashboard', 'view_reservations', 'create_reservation', 'edit_reservation',
      'cancel_reservation', 'postpone_reservation', 'view_date_slots', 'create_date_slot',
      'edit_date_slot', 'delete_date_slot', 'change_hall', 'view_menus', 'create_menu',
      'edit_menu', 'delete_menu', 'attach_menu', 'remove_menu', 'view_menu_rate_plans',
      'create_menu_rate_plan', 'edit_menu_rate_plan', 'delete_menu_rate_plan', 'view_halls',
      'create_hall', 'edit_hall', 'delete_hall', 'create_partition', 'edit_partition',
      'delete_partition', 'view_hall_rates', 'create_hall_rate', 'edit_hall_rate',
      'delete_hall_rate', 'view_extra_charges', 'create_extra_charge', 'edit_extra_charge',
      'delete_extra_charge', 'void_extra_charge', 'view_folio', 'generate_bill',
      'regenerate_bill', 'post_to_room', 'record_deposit', 'settle_deposit', 'delete_deposit',
      'initiate_payment', 'view_payments', 'refund_payment', 'view_packages', 'create_package',
      'edit_package', 'delete_package', 'attach_package', 'view_discounts', 'create_discount',
      'edit_discount', 'delete_discount', 'view_beo', 'edit_beo', 'view_reports',
    ],
  },
  supervisor: {
    name: 'supervisor',
    description: 'Supervisory — view and operational access',
    permissions: [
      'view_dashboard', 'view_reservations', 'create_reservation', 'edit_reservation',
      'view_date_slots', 'create_date_slot', 'edit_date_slot', 'change_hall', 'view_menus',
      'create_menu', 'edit_menu', 'attach_menu', 'remove_menu', 'view_menu_rate_plans',
      'create_menu_rate_plan', 'edit_menu_rate_plan', 'view_halls', 'create_hall',
      'edit_hall', 'create_partition', 'edit_partition', 'view_hall_rates', 'create_hall_rate',
      'edit_hall_rate', 'view_extra_charges', 'create_extra_charge', 'edit_extra_charge',
      'view_folio', 'generate_bill', 'regenerate_bill', 'post_to_room', 'record_deposit',
      'settle_deposit', 'initiate_payment', 'view_payments', 'view_packages', 'create_package',
      'edit_package', 'attach_package', 'view_discounts', 'create_discount', 'edit_discount',
      'view_beo', 'edit_beo', 'view_reports',
    ],
  },
  front_office: {
    name: 'front_office',
    description: 'Front office — reservations, menus, folios, deposits',
    permissions: [
      'view_dashboard', 'view_reservations', 'create_reservation', 'edit_reservation',
      'view_date_slots', 'create_date_slot', 'edit_date_slot', 'change_hall', 'view_menus',
      'attach_menu', 'remove_menu', 'view_halls', 'view_hall_rates', 'view_extra_charges',
      'view_folio', 'generate_bill', 'regenerate_bill', 'post_to_room', 'record_deposit',
      'settle_deposit', 'initiate_payment', 'view_payments', 'view_packages', 'attach_package',
      'view_discounts', 'view_beo',
    ],
  },
  cashier: {
    name: 'cashier',
    description: 'Cashier — billing, payments, deposits, folios',
    permissions: [
      'view_dashboard', 'view_reservations', 'view_date_slots', 'view_menus', 'view_halls',
      'view_extra_charges', 'view_folio', 'generate_bill', 'regenerate_bill', 'post_to_room',
      'record_deposit', 'settle_deposit', 'delete_deposit', 'initiate_payment',
      'view_payments', 'refund_payment', 'view_packages', 'attach_package', 'view_discounts',
      'view_beo', 'view_reports',
    ],
  },
  banquet_host: {
    name: 'banquet_host',
    description: 'Banquet host — view reservations, menus, halls',
    permissions: [
      'view_dashboard', 'view_reservations', 'view_date_slots', 'view_menus', 'view_halls',
      'view_extra_charges', 'view_folio', 'view_packages', 'view_discounts', 'view_beo',
    ],
  },
  sales: {
    name: 'sales',
    description: 'Sales — create and edit reservations, menus, packages',
    permissions: [
      'view_dashboard', 'view_reservations', 'create_reservation', 'edit_reservation',
      'view_date_slots', 'create_date_slot', 'edit_date_slot', 'view_menus', 'create_menu',
      'edit_menu', 'attach_menu', 'remove_menu', 'view_halls', 'view_hall_rates',
      'view_extra_charges', 'create_extra_charge', 'edit_extra_charge', 'view_folio',
      'generate_bill', 'view_packages', 'create_package', 'edit_package', 'attach_package',
      'view_discounts', 'create_discount', 'edit_discount', 'view_beo', 'edit_beo',
      'view_reports',
    ],
  },
};

async function seedRoles() {
  for (const [key, def] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { name: def.name },
      update: { description: def.description },
      create: { name: def.name, description: def.description },
    });

    if (def.permissions !== '*') {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      for (const perm of def.permissions) {
        await prisma.rolePermission.create({
          data: { roleId: role.id, permission: perm },
        });
      }
    }
  }

  console.log('Roles seeded successfully');
}

seedRoles()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());