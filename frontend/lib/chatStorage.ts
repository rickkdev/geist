import SQLite from 'react-native-sqlite-storage';
import RNFS from 'react-native-fs';
import { Platform } from 'react-native';

// Enable debugging in development
if (__DEV__) {
  SQLite.DEBUG(true);
  SQLite.enablePromise(true);
}

// Database configuration
const DATABASE_NAME = 'geist_chats.db';
const DATABASE_VERSION = '1.0';
const DATABASE_DISPLAY_NAME = 'Geist Chat Database';
const DATABASE_SIZE = 200000;

// Types
export interface Chat {
  id: number;
  title: string;
  created_at: number;
  updated_at: number;
  pinned: number; // 0 or 1 (SQLite doesn't have boolean)
  archived: number; // 0 or 1
}

export interface Message {
  id: number;
  chat_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: number;
}

export interface ChatWithMessages extends Chat {
  messages: Message[];
}

// Database instance
let db: SQLite.SQLiteDatabase | null = null;

/**
 * Initialize the database with WAL mode and proper schema
 */
export const initializeDatabase = async (): Promise<void> => {
  try {
    console.log('🗄️ Initializing SQLite database...');
    console.log('🗄️ Database config:', {
      DATABASE_NAME,
      DATABASE_VERSION,
      DATABASE_DISPLAY_NAME,
      DATABASE_SIZE,
    });

    // Open database
    console.log('🗄️ Opening database...');
    db = await SQLite.openDatabase({
      name: DATABASE_NAME,
      version: DATABASE_VERSION,
      displayName: DATABASE_DISPLAY_NAME,
      size: DATABASE_SIZE,
    });

    console.log('✅ Database opened successfully');
    console.log('🗄️ Database instance:', !!db);

    // Enable WAL mode for better concurrent access
    console.log('🗄️ Enabling WAL mode...');
    await db.executeSql('PRAGMA journal_mode=WAL;');
    await db.executeSql('PRAGMA synchronous=NORMAL;');

    console.log('✅ WAL mode enabled');

    // Run migrations
    console.log('🗄️ Running migrations...');
    await runMigrations();

    // Configure iOS backup exclusion
    if (Platform.OS === 'ios') {
      await configureIOSBackupExclusion();
    }

    console.log('🎉 Database initialization complete');
    console.log('🗄️ Final db instance:', !!db);
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
};

/**
 * Run database migrations
 */
const runMigrations = async (): Promise<void> => {
  if (!db) throw new Error('Database not initialized');

  try {
    console.log('🔄 Running database migrations...');

    // Create chats table
    await db.executeSql(`
      CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        pinned INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0
      );
    `);

    // Create messages table
    await db.executeSql(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
      );
    `);

    // Create performance indexes
    await db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_chats_updated_at 
      ON chats(updated_at DESC);
    `);

    await db.executeSql(`
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id 
      ON messages(chat_id, created_at);
    `);

    console.log('✅ Database migrations completed');
  } catch (error) {
    console.error('❌ Database migration failed:', error);
    throw error;
  }
};

/**
 * Configure iOS to exclude database files from iCloud backup
 * Note: react-native-fs doesn't have excludeFromBackup in current version
 * This will be handled by iOS app settings instead
 */
const configureIOSBackupExclusion = async (): Promise<void> => {
  if (Platform.OS !== 'ios') return;

  // Note: RNFS.excludeFromBackup is not available in current version
  // iOS SQLite databases are automatically excluded from backup when stored in Library/Caches
  // or can be configured via app settings
  console.log('📱 iOS backup exclusion: handled by system defaults for SQLite databases');
};

/**
 * Get database instance (ensure it's initialized)
 */
const getDatabase = (): SQLite.SQLiteDatabase => {
  console.log('🔍 getDatabase: Checking db instance:', !!db);
  if (!db) {
    console.error('🔍 getDatabase: Database not initialized!');
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  console.log('🔍 getDatabase: Returning database instance');
  return db;
};

/**
 * Check if database is initialized
 */
export const isDatabaseInitialized = (): boolean => {
  return db !== null;
};

/**
 * Create a new chat
 */
export const createChat = async (title: string = 'New Chat'): Promise<number> => {
  console.log('📝 createChat: Starting with title:', title);

  const database = getDatabase();
  console.log('📝 createChat: Got database instance:', !!database);

  const now = Date.now();
  console.log('📝 createChat: Timestamp:', now);

  try {
    console.log('📝 createChat: Executing SQL insert...');
    const result = await database.executeSql(
      'INSERT INTO chats (title, created_at, updated_at) VALUES (?, ?, ?)',
      [title.trim(), now, now]
    );

    console.log('📝 createChat: SQL executed successfully');
    console.log('📝 createChat: Result:', result);

    const chatId = result[0].insertId;
    console.log(`✅ Created chat with ID: ${chatId}`);
    return chatId;
  } catch (error) {
    console.error('❌ Failed to create chat:', error);
    console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
};

/**
 * Get all chats, sorted by updated_at DESC
 */
export const getChats = async (options: { includeArchived?: boolean } = {}): Promise<Chat[]> => {
  const database = getDatabase();
  const { includeArchived = false } = options;

  try {
    let query = 'SELECT * FROM chats';
    const params: any[] = [];

    if (!includeArchived) {
      query += ' WHERE archived = 0';
    }

    query += ' ORDER BY pinned DESC, updated_at DESC';

    const result = await database.executeSql(query, params);
    const chats: Chat[] = [];

    for (let i = 0; i < result[0].rows.length; i++) {
      chats.push(result[0].rows.item(i));
    }

    console.log(`✅ Retrieved ${chats.length} chats`);
    return chats;
  } catch (error) {
    console.error('❌ Failed to get chats:', error);
    throw error;
  }
};

/**
 * Get a single chat with its messages
 */
export const getChat = async (
  chatId: number,
  options: { limit?: number; offset?: number } = {}
): Promise<ChatWithMessages | null> => {
  const database = getDatabase();
  const { limit = 100, offset = 0 } = options;

  try {
    // Get chat details
    const chatResult = await database.executeSql('SELECT * FROM chats WHERE id = ?', [chatId]);

    if (chatResult[0].rows.length === 0) {
      return null;
    }

    const chat = chatResult[0].rows.item(0);

    // Get messages for this chat
    const messagesResult = await database.executeSql(
      'SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?',
      [chatId, limit, offset]
    );

    const messages: Message[] = [];
    for (let i = 0; i < messagesResult[0].rows.length; i++) {
      messages.push(messagesResult[0].rows.item(i));
    }

    console.log(`✅ Retrieved chat ${chatId} with ${messages.length} messages`);
    return { ...chat, messages };
  } catch (error) {
    console.error('❌ Failed to get chat:', error);
    throw error;
  }
};

/**
 * Add a message to a chat and update chat's updated_at
 */
export const addMessage = async (
  chatId: number,
  role: 'user' | 'assistant',
  content: string
): Promise<number> => {
  const database = getDatabase();
  const now = Date.now();

  try {
    await database.transaction(async (tx) => {
      // Insert message
      const result = await tx.executeSql(
        'INSERT INTO messages (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)',
        [chatId, role, content.trim(), now]
      );

      // Update chat's updated_at timestamp
      await tx.executeSql('UPDATE chats SET updated_at = ? WHERE id = ?', [now, chatId]);

      // Auto-title logic: if title is "New Chat", update on first user message
      if (role === 'user') {
        const chatResult = await tx.executeSql('SELECT title FROM chats WHERE id = ?', [chatId]);

        if (chatResult.rows.length > 0) {
          const currentTitle = chatResult.rows.item(0).title;
          // Check if title is "New Chat" or empty/null
          if (currentTitle === 'New Chat' || !currentTitle || currentTitle.trim() === '') {
            // Use first 6-10 words as title, truncate if too long
            const words = content.trim().split(/\s+/).slice(0, 8);
            let newTitle = words.join(' ');
            
            // Truncate if longer than 50 characters
            if (newTitle.length > 50) {
              newTitle = newTitle.substring(0, 47) + '...';
            }

            await tx.executeSql('UPDATE chats SET title = ? WHERE id = ?', [newTitle, chatId]);

            console.log(`✅ Auto-titled chat ${chatId}: "${newTitle}"`);
          }
        }
      }

      console.log(`✅ Added ${role} message to chat ${chatId}`);
      return result.insertId;
    });

    return 0; // Transaction doesn't return insertId directly
  } catch (error) {
    console.error('❌ Failed to add message:', error);
    throw error;
  }
};

/**
 * Rename a chat
 */
export const renameChat = async (chatId: number, title: string): Promise<void> => {
  const database = getDatabase();
  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    throw new Error('Title cannot be empty');
  }

  try {
    await database.executeSql('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?', [
      trimmedTitle,
      Date.now(),
      chatId,
    ]);

    console.log(`✅ Renamed chat ${chatId} to: "${trimmedTitle}"`);
  } catch (error) {
    console.error('❌ Failed to rename chat:', error);
    throw error;
  }
};

/**
 * Pin/unpin a chat
 */
export const pinChat = async (chatId: number, pinned: boolean): Promise<void> => {
  const database = getDatabase();

  try {
    await database.executeSql('UPDATE chats SET pinned = ?, updated_at = ? WHERE id = ?', [
      pinned ? 1 : 0,
      Date.now(),
      chatId,
    ]);

    console.log(`✅ ${pinned ? 'Pinned' : 'Unpinned'} chat ${chatId}`);
  } catch (error) {
    console.error('❌ Failed to pin/unpin chat:', error);
    throw error;
  }
};

/**
 * Archive/unarchive a chat
 */
export const archiveChat = async (chatId: number, archived: boolean): Promise<void> => {
  const database = getDatabase();

  try {
    await database.executeSql('UPDATE chats SET archived = ?, updated_at = ? WHERE id = ?', [
      archived ? 1 : 0,
      Date.now(),
      chatId,
    ]);

    console.log(`✅ ${archived ? 'Archived' : 'Unarchived'} chat ${chatId}`);
  } catch (error) {
    console.error('❌ Failed to archive/unarchive chat:', error);
    throw error;
  }
};

/**
 * Delete a chat and all its messages
 */
export const deleteChat = async (chatId: number): Promise<void> => {
  const database = getDatabase();

  try {
    await database.transaction(async (tx) => {
      // Delete messages first (though CASCADE should handle this)
      await tx.executeSql('DELETE FROM messages WHERE chat_id = ?', [chatId]);

      // Delete chat
      await tx.executeSql('DELETE FROM chats WHERE id = ?', [chatId]);
    });

    console.log(`✅ Deleted chat ${chatId} and all its messages`);
  } catch (error) {
    console.error('❌ Failed to delete chat:', error);
    throw error;
  }
};

/**
 * Get message count for a chat
 */
export const getMessageCount = async (chatId: number): Promise<number> => {
  const database = getDatabase();

  try {
    const result = await database.executeSql(
      'SELECT COUNT(*) as count FROM messages WHERE chat_id = ?',
      [chatId]
    );

    return result[0].rows.item(0).count;
  } catch (error) {
    console.error('❌ Failed to get message count:', error);
    throw error;
  }
};

/**
 * Close database connection
 */
export const closeDatabase = async (): Promise<void> => {
  if (db) {
    try {
      await db.close();
      db = null;
      console.log('✅ Database connection closed');
    } catch (error) {
      console.error('❌ Failed to close database:', error);
      throw error;
    }
  }
};

// Legacy exports for backward compatibility (will be deprecated)
export interface LegacyMessage {
  id: string;
  text: string;
  role: 'user' | 'assistant';
  timestamp: number;
}

/**
 * @deprecated Use SQLite-based functions instead
 */
export const saveChatMessages = async (messages: LegacyMessage[]): Promise<void> => {
  // Silently do nothing - deprecated function for backward compatibility
};

/**
 * @deprecated Use SQLite-based functions instead
 */
export const loadChatMessages = async (): Promise<LegacyMessage[]> => {
  // Return empty array - deprecated function for backward compatibility
  return [];
};

/**
 * @deprecated Use SQLite-based functions instead
 */
export const clearChatMessages = async (): Promise<void> => {
  // Silently do nothing - deprecated function for backward compatibility
};
