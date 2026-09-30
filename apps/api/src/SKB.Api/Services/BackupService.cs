using System.Buffers.Binary;
using System.Data;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using SKB.Api.Data;

namespace SKB.Api.Services;

/// <summary>
/// Backups (النسخ الاحتياطي) made by the app itself, so they work the same on the cloud and on the
/// office server, with no database tools installed.
/// <para>
/// A backup is a zip: <c>manifest.json</c> (format, the database version it came from, row
/// counts) and one CSV per table, all read in one consistent snapshot while people keep working.
/// Signed-in sessions are left out, so everyone signs in again after a restore.
/// </para>
/// <para>
/// With a passphrase the zip is encrypted (<c>.skbak</c>): AES-256-GCM in 1 MB chunks, with a key
/// derived by PBKDF2-SHA256; each chunk's number and "last" flag are authenticated, so a changed,
/// reordered or cut-off file is refused. Without the passphrase the backup can't be read — by
/// anyone, including us.
/// </para>
/// <para>
/// Restoring is a server command (<c>SKB.Api restore &lt;file&gt;</c>), never a web button: it fills
/// a new, empty database, then brings it up to this version.
/// </para>
/// </summary>
public sealed class BackupService
{
    public const int MinPassphrase = 8;
    public const int MaxPassphrase = 200;
    private const string Format = "skb-backup";
    private const int FormatVersion = 1;
    private static readonly byte[] Magic = "SKBBAK1\n"u8.ToArray();
    private const int Iterations = 600_000;
    private const int ChunkSize = 1 << 20;
    private const int TagSize = 16;
    /// <summary>Signed-in sessions: not business data, and a restore signs everyone out.</summary>
    private static readonly HashSet<string> Skipped = new() { "Sessions" };

    private readonly AppDbContext _db;

    public BackupService(AppDbContext db) => _db = db;

    public sealed record Manifest(
        string Format, int Version, string CreatedAt, string Migration, string? AppVersion, ManifestTable[] Tables);

    public sealed record ManifestTable(string Name, long Rows);

    // ------------------------------------------------------------------ making a backup

    /// <summary>Write the backup (encrypted when a passphrase is given) to a file.</summary>
    public async Task<Manifest> WriteFileAsync(string path, string? passphrase, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(passphrase))
        {
            await using var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write);
            return await WriteZipAsync(file, ct);
        }
        var zipPath = path + ".zip.tmp";
        try
        {
            Manifest manifest;
            await using (var zip = new FileStream(zipPath, FileMode.CreateNew, FileAccess.ReadWrite))
                manifest = await WriteZipAsync(zip, ct);
            await using (var plain = File.OpenRead(zipPath))
            await using (var output = new FileStream(path, FileMode.CreateNew, FileAccess.Write))
                await EncryptAsync(plain, output, passphrase, ct);
            return manifest;
        }
        finally
        {
            File.Delete(zipPath);
        }
    }

    /// <summary>Every table as CSV, read in one snapshot, into a zip.</summary>
    public async Task<Manifest> WriteZipAsync(Stream output, CancellationToken ct = default)
    {
        var tables = TableNames(_db.Model).Where(t => !Skipped.Contains(t)).ToList();
        var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
        await _db.Database.OpenConnectionAsync(ct);
        try
        {
            // One snapshot for every table: a sale saved halfway through the backup is either
            // wholly in it or wholly not.
            await using var tx = await conn.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
            await Exec(conn, tx, "SET TRANSACTION READ ONLY", ct);
            var migration = (string?)await Scalar(conn, tx,
                "SELECT \"MigrationId\" FROM \"__EFMigrationsHistory\" ORDER BY \"MigrationId\" DESC LIMIT 1", ct)
                ?? throw new InvalidOperationException("The database has no SKB tables.");
            var counts = new List<ManifestTable>();
            using (var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
            {
                foreach (var table in tables)
                {
                    var rows = (long)(await Scalar(conn, tx, $"SELECT count(*) FROM {Quote(table)}", ct))!;
                    counts.Add(new ManifestTable(table, rows));
                    var entry = zip.CreateEntry($"tables/{table}.csv", CompressionLevel.Optimal);
                    await using var entryStream = entry.Open();
                    await using var writer = new StreamWriter(entryStream, new UTF8Encoding(false));
                    using var reader = await conn.BeginTextExportAsync(
                        $"COPY {Quote(table)} TO STDOUT (FORMAT csv, HEADER true)", ct);
                    var buffer = new char[81920];
                    int n;
                    while ((n = await reader.ReadAsync(buffer, ct)) > 0) await writer.WriteAsync(buffer.AsMemory(0, n), ct);
                }
                var manifest = new Manifest(Format, FormatVersion, DateTime.UtcNow.ToString("o"), migration,
                    AppVersion(), counts.ToArray());
                var m = zip.CreateEntry("manifest.json", CompressionLevel.Optimal);
                await using (var ms = m.Open())
                    await JsonSerializer.SerializeAsync(ms, manifest, JsonOptions, ct);
                await tx.CommitAsync(ct);
                return manifest;
            }
        }
        finally
        {
            await _db.Database.CloseConnectionAsync();
        }
    }

    // ------------------------------------------------------------------ restoring

    /// <summary>
    /// Restore a backup file into this (new, empty) database, then bring it up to this version.
    /// Nothing is written unless the whole backup loads and checks out.
    /// </summary>
    public async Task<Manifest> RestoreFileAsync(string path, Func<string> passphrase, Action<string> log,
        CancellationToken ct = default)
    {
        await using var input = File.OpenRead(path);
        var head = new byte[Magic.Length];
        var read = await input.ReadAtLeastAsync(head, head.Length, throwOnEndOfStream: false, ct);
        input.Position = 0;
        if (read == Magic.Length && head.AsSpan().SequenceEqual(Magic))
        {
            var zipPath = Path.Combine(Path.GetTempPath(), $"skb-restore-{Guid.NewGuid():N}.zip");
            try
            {
                await using (var plain = new FileStream(zipPath, FileMode.CreateNew, FileAccess.Write))
                    await DecryptAsync(input, plain, passphrase(), ct);
                await using var zip = File.OpenRead(zipPath);
                return await RestoreZipAsync(zip, log, ct);
            }
            finally
            {
                File.Delete(zipPath);
            }
        }
        if (read >= 2 && head[0] == (byte)'P' && head[1] == (byte)'K') return await RestoreZipAsync(input, log, ct);
        throw new BackupException("This isn't an SKB backup file.");
    }

    public async Task<Manifest> RestoreZipAsync(Stream zipStream, Action<string> log, CancellationToken ct = default)
    {
        using var zip = new ZipArchive(zipStream, ZipArchiveMode.Read);
        var manifestEntry = zip.GetEntry("manifest.json") ?? throw new BackupException("This isn't an SKB backup file.");
        Manifest manifest;
        await using (var ms = manifestEntry.Open())
            manifest = await JsonSerializer.DeserializeAsync<Manifest>(ms, JsonOptions, ct)
                       ?? throw new BackupException("The backup's manifest is unreadable.");
        if (manifest.Format != Format || manifest.Version != FormatVersion)
            throw new BackupException("This isn't an SKB backup file, or it's from a newer version of SKB.");
        if (!_db.Database.GetMigrations().Contains(manifest.Migration))
            throw new BackupException("This backup is from a newer version of SKB. Update SKB first, then restore.");
        if ((await _db.Database.GetAppliedMigrationsAsync(ct)).Any())
            throw new BackupException(
                "This database isn't empty. Restore into a new, empty database, before SKB first starts on it.");

        log($"Backup of {manifest.CreatedAt}, database version {manifest.Migration}.");
        var migrator = _db.GetService<IMigrator>();
        await migrator.MigrateAsync(manifest.Migration, ct);

        var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
        await _db.Database.OpenConnectionAsync(ct);
        try
        {
            await using var tx = await conn.BeginTransactionAsync(ct);
            // Tables may refer to each other both ways, so the links are set aside while the rows go
            // in and put back afterwards — which checks every one of them.
            var links = new List<(string Table, string Name, string Definition)>();
            await using (var cmd = new NpgsqlCommand("""
                SELECT c.conrelid::regclass::text, c.conname, pg_get_constraintdef(c.oid)
                FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
                """, conn, tx))
            await using (var r = await cmd.ExecuteReaderAsync(ct))
                while (await r.ReadAsync(ct)) links.Add((r.GetString(0), r.GetString(1), r.GetString(2)));
            foreach (var l in links) await Exec(conn, tx, $"ALTER TABLE {l.Table} DROP CONSTRAINT {Quote(l.Name)}", ct);

            // Migrations may have added starting rows; the backup replaces them.
            var model = TableNames(_db.Model).ToList();
            if (model.Count > 0)
                await Exec(conn, tx, $"TRUNCATE {string.Join(", ", model.Select(Quote))}", ct);

            foreach (var table in manifest.Tables)
            {
                if (!model.Contains(table.Name)) throw new BackupException($"Unknown table {table.Name} in the backup.");
                var entry = zip.GetEntry($"tables/{table.Name}.csv")
                            ?? throw new BackupException($"The backup is missing {table.Name}.");
                string header;
                await using (var s = entry.Open())
                using (var sr = new StreamReader(s, Encoding.UTF8))
                    header = await sr.ReadLineAsync(ct) ?? "";
                var columns = string.Join(", ", ParseCsvLine(header).Select(Quote));
                await using (var s = entry.Open())
                using (var sr = new StreamReader(s, Encoding.UTF8))
                await using (var writer = await conn.BeginTextImportAsync(
                                 $"COPY {Quote(table.Name)} ({columns}) FROM STDIN (FORMAT csv, HEADER true)", ct))
                {
                    var buffer = new char[81920];
                    int n;
                    while ((n = await sr.ReadAsync(buffer, ct)) > 0) await writer.WriteAsync(buffer.AsMemory(0, n), ct);
                }
                var rows = (long)(await Scalar(conn, tx, $"SELECT count(*) FROM {Quote(table.Name)}", ct))!;
                if (rows != table.Rows)
                    throw new BackupException($"{table.Name}: {rows} rows loaded, the backup says {table.Rows}.");
                log($"  {table.Name}: {rows}");
            }

            foreach (var l in links) await Exec(conn, tx, $"ALTER TABLE {l.Table} ADD CONSTRAINT {Quote(l.Name)} {l.Definition}", ct);

            // Counters that come from sequences continue after the restored rows — a column's own
            // sequence, or a shared one its default draws from (e.g. customer codes).
            var sequences = new List<(string Table, string Column, string Sequence)>();
            await using (var cmd = new NpgsqlCommand("""
                SELECT table_name, column_name,
                       COALESCE(pg_get_serial_sequence(quote_ident(table_name), column_name),
                                substring(column_default from 'nextval\(''([^'']+)''')) AS seq
                FROM information_schema.columns
                WHERE table_schema = 'public' AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')
                """, conn, tx))
            await using (var r = await cmd.ExecuteReaderAsync(ct))
                while (await r.ReadAsync(ct))
                    if (!r.IsDBNull(2)) sequences.Add((r.GetString(0), r.GetString(1), r.GetString(2)));
            // Several columns may share a sequence: it continues after the largest of them.
            foreach (var group in sequences.GroupBy(s => s.Sequence))
            {
                var max = string.Join(", ", group.Select(s => $"(SELECT max({Quote(s.Column)}) FROM {Quote(s.Table)})"));
                await Exec(conn, tx, $"""
                    SELECT setval('{group.Key.Replace("'", "''")}', COALESCE(GREATEST({max}), 0) + 1, false)
                    """, ct);
            }

            await tx.CommitAsync(ct);
        }
        finally
        {
            await _db.Database.CloseConnectionAsync();
        }

        log("Bringing the database up to this version…");
        await migrator.MigrateAsync(cancellationToken: ct);
        return manifest;
    }

    // ------------------------------------------------------------------ encryption

    public static async Task EncryptAsync(Stream plain, Stream output, string passphrase, CancellationToken ct = default)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var prefix = RandomNumberGenerator.GetBytes(4);
        var key = DeriveKey(passphrase, salt, Iterations);
        var header = new byte[Magic.Length + 16 + 4 + 4];
        Magic.CopyTo(header, 0);
        salt.CopyTo(header, Magic.Length);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(Magic.Length + 16), Iterations);
        prefix.CopyTo(header, Magic.Length + 20);
        await output.WriteAsync(header, ct);

        using var gcm = new AesGcm(key, TagSize);
        var current = new byte[ChunkSize];
        var next = new byte[ChunkSize];
        var n = await plain.ReadAtLeastAsync(current, ChunkSize, throwOnEndOfStream: false, ct);
        for (long index = 0; ; index++)
        {
            var m = n == ChunkSize ? await plain.ReadAtLeastAsync(next, ChunkSize, throwOnEndOfStream: false, ct) : 0;
            var last = m == 0;
            var cipher = new byte[n];
            var tag = new byte[TagSize];
            gcm.Encrypt(Nonce(prefix, index), current.AsSpan(0, n), cipher, tag, Aad(index, last));
            var chunkHeader = new byte[5];
            chunkHeader[0] = last ? (byte)1 : (byte)0;
            BinaryPrimitives.WriteInt32BigEndian(chunkHeader.AsSpan(1), n);
            await output.WriteAsync(chunkHeader, ct);
            await output.WriteAsync(cipher, ct);
            await output.WriteAsync(tag, ct);
            if (last) break;
            (current, next) = (next, current);
            n = m;
        }
    }

    public static async Task DecryptAsync(Stream input, Stream plain, string passphrase, CancellationToken ct = default)
    {
        var header = new byte[Magic.Length + 16 + 4 + 4];
        await ReadExactly(input, header, ct);
        if (!header.AsSpan(0, Magic.Length).SequenceEqual(Magic)) throw new BackupException("This isn't an SKB backup file.");
        var salt = header.AsSpan(Magic.Length, 16).ToArray();
        var iterations = BinaryPrimitives.ReadInt32BigEndian(header.AsSpan(Magic.Length + 16));
        if (iterations is < 100_000 or > 10_000_000) throw new BackupException("The backup file is damaged.");
        var prefix = header.AsSpan(Magic.Length + 20, 4).ToArray();
        using var gcm = new AesGcm(DeriveKey(passphrase, salt, iterations), TagSize);
        var chunkHeader = new byte[5];
        var tag = new byte[TagSize];
        for (long index = 0; ; index++)
        {
            await ReadExactly(input, chunkHeader, ct);
            var last = chunkHeader[0] switch
            {
                0 => false, 1 => true, _ => throw new BackupException("The backup file is damaged."),
            };
            var n = BinaryPrimitives.ReadInt32BigEndian(chunkHeader.AsSpan(1));
            if (n is < 0 or > ChunkSize) throw new BackupException("The backup file is damaged.");
            var cipher = new byte[n];
            await ReadExactly(input, cipher, ct);
            await ReadExactly(input, tag, ct);
            var data = new byte[n];
            try
            {
                gcm.Decrypt(Nonce(prefix, index), cipher, tag, data, Aad(index, last));
            }
            catch (CryptographicException)
            {
                throw new BackupException(index == 0
                    ? "Wrong passphrase, or the backup file is damaged."
                    : "The backup file is damaged.");
            }
            await plain.WriteAsync(data, ct);
            if (last) break;
        }
        if (input.ReadByte() != -1) throw new BackupException("The backup file is damaged.");
    }

    private static byte[] DeriveKey(string passphrase, byte[] salt, int iterations) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(passphrase), salt, iterations, HashAlgorithmName.SHA256, 32);

    private static byte[] Nonce(byte[] prefix, long index)
    {
        var nonce = new byte[12];
        prefix.CopyTo(nonce, 0);
        BinaryPrimitives.WriteInt64BigEndian(nonce.AsSpan(4), index);
        return nonce;
    }

    private static byte[] Aad(long index, bool last)
    {
        var aad = new byte[9];
        BinaryPrimitives.WriteInt64BigEndian(aad, index);
        aad[8] = last ? (byte)1 : (byte)0;
        return aad;
    }

    private static async Task ReadExactly(Stream s, byte[] buffer, CancellationToken ct)
    {
        if (await s.ReadAtLeastAsync(buffer, buffer.Length, throwOnEndOfStream: false, ct) < buffer.Length)
            throw new BackupException("The backup file is cut short.");
    }

    // ------------------------------------------------------------------ helpers

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    /// <summary>The app's tables, each once (owned types share their owner's table).</summary>
    public static IEnumerable<string> TableNames(IModel model) =>
        model.GetEntityTypes().Select(t => t.GetTableName()).OfType<string>().Distinct().OrderBy(t => t, StringComparer.Ordinal);

    private static string Quote(string identifier) => "\"" + identifier.Replace("\"", "\"\"") + "\"";

    private static string? AppVersion()
    {
        var commit = Environment.GetEnvironmentVariable("RENDER_GIT_COMMIT");
        return string.IsNullOrEmpty(commit) ? null : commit[..Math.Min(7, commit.Length)];
    }

    private static async Task Exec(NpgsqlConnection conn, NpgsqlTransaction tx, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static async Task<object?> Scalar(NpgsqlConnection conn, NpgsqlTransaction tx, string sql, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(sql, conn, tx);
        var v = await cmd.ExecuteScalarAsync(ct);
        return v is DBNull ? null : v;
    }

    /// <summary>One CSV line (the header) into its fields.</summary>
    private static List<string> ParseCsvLine(string line)
    {
        var fields = new List<string>();
        var sb = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < line.Length; i++)
        {
            var c = line[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else sb.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == ',') { fields.Add(sb.ToString()); sb.Clear(); }
            else sb.Append(c);
        }
        fields.Add(sb.ToString());
        return fields;
    }
}

/// <summary>A backup that can't be made or restored, with a message for the person.</summary>
public sealed class BackupException : Exception
{
    public BackupException(string message) : base(message) { }
}
