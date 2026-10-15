const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createPermissionTables() {
  const sql = `
    CREATE TABLE IF NOT EXISTS User (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(191) UNIQUE,
      passwordHash VARCHAR(191),
      fullName VARCHAR(191),
      email VARCHAR(191),
      phone VARCHAR(191),
      isActive BOOLEAN DEFAULT TRUE,
      lastLoginAt DATETIME(3),
      createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    );

    CREATE TABLE IF NOT EXISTS Role (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(191) UNIQUE,
      description TEXT,
      createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      updatedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
    );

    CREATE TABLE IF NOT EXISTS RolePermission (
      id INT AUTO_INCREMENT PRIMARY KEY,
      roleId INT,
      permission VARCHAR(191),
      createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      FOREIGN KEY (roleId) REFERENCES Role(id) ON DELETE CASCADE,
      UNIQUE KEY RolePermission_roleId_permission_key (roleId, permission)
    );

    CREATE TABLE IF NOT EXISTS UserPermission (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT,
      permission VARCHAR(191),
      grantedBy INT,
      grantedAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
      UNIQUE KEY UserPermission_userId_permission_key (userId, permission)
    );

    CREATE TABLE IF NOT EXISTS UserAuditLog (
      id INT AUTO_INCREMENT PRIMARY KEY,
      userId INT,
      action VARCHAR(191),
      resource VARCHAR(191),
      details TEXT,
      ipAddress VARCHAR(191),
      userAgent TEXT,
      createdAt DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
      FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
      INDEX UserAuditLog_userId_idx (userId),
      INDEX UserAuditLog_createdAt_idx (createdAt)
    );
  `;

  for (const statement of sql.split(';').map(s => s.trim()).filter(s => s)) {
    await prisma.$executeRawUnsafe(statement);
  }

  console.log('Permission tables created successfully');
}

createPermissionTables()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());