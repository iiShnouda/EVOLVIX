using System.Text;

namespace SKB.Api.Services;

/// <summary>
/// The server's backup commands, run instead of the web server:
/// <code>
/// SKB.Api backup  &lt;file&gt;   # write a backup (encrypted when a passphrase is given)
/// SKB.Api restore &lt;file&gt;   # restore one into a new, empty database
/// </code>
/// The database is the one in the usual settings (<c>ConnectionStrings__Default</c>). The
/// passphrase comes from <c>SKB_BACKUP_PASSPHRASE</c>, else it is asked for (not shown as typed).
/// </summary>
public static class BackupCommands
{
    public static async Task<int> RunAsync(IServiceProvider services, string[] args)
    {
        if (args.Length < 2)
        {
            Console.Error.WriteLine("Usage: SKB.Api backup <file> | SKB.Api restore <file>");
            return 2;
        }
        var file = Path.GetFullPath(args[1]);
        using var scope = services.CreateScope();
        var backup = scope.ServiceProvider.GetRequiredService<BackupService>();
        try
        {
            if (args[0] == "backup")
            {
                if (File.Exists(file)) throw new BackupException($"{file} already exists.");
                var passphrase = Passphrase("Passphrase for the backup (Enter for none): ", allowEmpty: true);
                if (passphrase.Length is > 0 and < BackupService.MinPassphrase)
                    throw new BackupException("Choose a passphrase of at least 8 characters.");
                var manifest = await backup.WriteFileAsync(file, passphrase.Length == 0 ? null : passphrase);
                Console.WriteLine($"Backup written to {file}: {manifest.Tables.Length} tables, " +
                                  $"{manifest.Tables.Sum(t => t.Rows)} rows{(passphrase.Length == 0 ? " (not encrypted)" : "")}.");
                return 0;
            }
            if (!File.Exists(file)) throw new BackupException($"{file} not found.");
            var restored = await backup.RestoreFileAsync(file, () => Passphrase("Backup passphrase: ", allowEmpty: false),
                Console.WriteLine);
            Console.WriteLine($"Restored {restored.Tables.Sum(t => t.Rows)} rows from the backup of {restored.CreatedAt}. " +
                              "Start SKB now; everyone signs in again.");
            return 0;
        }
        catch (BackupException e)
        {
            Console.Error.WriteLine(e.Message);
            return 1;
        }
    }

    private static string Passphrase(string prompt, bool allowEmpty)
    {
        var fromEnv = Environment.GetEnvironmentVariable("SKB_BACKUP_PASSPHRASE");
        if (fromEnv is not null) return fromEnv;
        if (Console.IsInputRedirected)
        {
            if (allowEmpty) return "";
            throw new BackupException("Set SKB_BACKUP_PASSPHRASE, or run this in a terminal to type it.");
        }
        Console.Write(prompt);
        var sb = new StringBuilder();
        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Enter) break;
            if (key.Key == ConsoleKey.Backspace) { if (sb.Length > 0) sb.Length--; }
            else if (!char.IsControl(key.KeyChar)) sb.Append(key.KeyChar);
        }
        Console.WriteLine();
        if (sb.Length == 0 && !allowEmpty) throw new BackupException("A passphrase is needed.");
        return sb.ToString();
    }
}
