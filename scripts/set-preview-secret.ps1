# Guarda UN valor en el Worker kynova-os-preview (Cloudflare) sin mostrarlo, sin dejarlo en el historial y sin escribirlo en ningun archivo.
# Lo ejecuta la persona responsable en su propia terminal; el valor nunca pasa por el chat ni por el repositorio.
#
# Uso (desde la raiz del repositorio, con la sesion de Wrangler iniciada):
#   powershell -ExecutionPolicy Bypass -File scripts/set-preview-secret.ps1 -Name GOOGLE_CLIENT_ID
#   powershell -ExecutionPolicy Bypass -File scripts/set-preview-secret.ps1 -Name GOOGLE_CLIENT_SECRET
#   powershell -ExecutionPolicy Bypass -File scripts/set-preview-secret.ps1 -Name SUPABASE_SERVICE_ROLE_KEY
#   powershell -ExecutionPolicy Bypass -File scripts/set-preview-secret.ps1 -Name SUPABASE_PUBLISHABLE_KEY -FromLocalEnv
# -FromLocalEnv (solo para la llave PUBLICABLE) la toma de .env.local en tu maquina; sin ese interruptor el valor se pide con entrada oculta.
# Comprueba la FORMA del valor (por ejemplo, que la llave publicable no sea la de servicio) y que las llaves de Supabase sean del proyecto de desarrollo. No imprime el valor.
# Prueba interna sin Wrangler ni red: -SelfTest
param(
  [ValidateSet('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET')][string]$Name,
  [switch]$FromLocalEnv,
  [switch]$SelfTest
)
$ErrorActionPreference = 'Stop'
$ProjectRef = 'hrridjfbrkewpengrmmh'

function Read-JwtPayload([string]$Token) {
  $parts = $Token.Split('.')
  if ($parts.Count -ne 3) { return $null }
  $b64 = $parts[1].Replace('-', '+').Replace('_', '/')
  while ($b64.Length % 4 -ne 0) { $b64 += '=' }
  try { return ([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) | ConvertFrom-Json) } catch { return $null }
}

# Devuelve $null si el valor tiene la forma correcta, o un texto que explica el problema (nunca incluye el valor).
function Test-SecretShape([string]$SecretName, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value -ne $Value.Trim() -or $Value -match '\s') { return 'el valor esta vacio o contiene espacios o saltos de linea' }
  switch ($SecretName) {
    'GOOGLE_CLIENT_ID' {
      if ($Value -notmatch '^[A-Za-z0-9._-]{10,200}\.apps\.googleusercontent\.com$') { return 'no parece un ID de cliente de Google (debe terminar en .apps.googleusercontent.com)' }
    }
    'GOOGLE_CLIENT_SECRET' {
      if ($Value -match 'apps\.googleusercontent\.com$') { return 'esto es el ID de cliente, no el secreto' }
      if ($Value.Length -lt 10 -or $Value.Length -gt 200) { return 'longitud inesperada para un secreto de cliente de Google' }
    }
    { $_ -in 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY' } {
      $wantService = ($SecretName -eq 'SUPABASE_SERVICE_ROLE_KEY')
      $isService = $false; $isPublic = $false
      if ($Value.StartsWith('sb_secret_')) { $isService = $true }
      elseif ($Value.StartsWith('sb_publishable_')) { $isPublic = $true }
      else {
        $payload = Read-JwtPayload $Value
        if ($null -eq $payload) { return 'no tiene la forma de una llave de Supabase' }
        if ($payload.role -eq 'service_role') { $isService = $true } elseif ($payload.role -eq 'anon') { $isPublic = $true } else { return 'la llave no es ni publicable ni de servicio' }
        if ($payload.ref -and $payload.ref -ne $ProjectRef) { return 'la llave pertenece a OTRO proyecto de Supabase' }
      }
      if ($wantService -and -not $isService) { return 'esto NO es la llave de servicio (service_role / sb_secret_)' }
      if (-not $wantService -and -not $isPublic) { return 'esto NO es la llave publicable: es una llave de servicio y no debe ir en esta variable' }
    }
  }
  return $null
}

function New-FakeJwt([hashtable]$Claims) {
  $enc = { param($o) [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(($o | ConvertTo-Json -Compress))).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
  return ((& $enc @{ alg = 'HS256'; typ = 'JWT' }) + '.' + (& $enc $Claims) + '.firmaDePrueba')
}

if ($SelfTest) {
  $cases = @(
    @('GOOGLE_CLIENT_ID', '123456-abcdef.apps.googleusercontent.com', $true),
    @('GOOGLE_CLIENT_ID', '123456-abcdef', $false),
    @('GOOGLE_CLIENT_SECRET', 'GOCSPX-valor-de-prueba-1234567890', $true),
    @('GOOGLE_CLIENT_SECRET', '123456-abcdef.apps.googleusercontent.com', $false),
    @('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_valorDePrueba123456', $true),
    @('SUPABASE_PUBLISHABLE_KEY', 'sb_secret_valorDePrueba123456', $false),
    @('SUPABASE_PUBLISHABLE_KEY', (New-FakeJwt @{ role = 'anon'; ref = $ProjectRef }), $true),
    @('SUPABASE_PUBLISHABLE_KEY', (New-FakeJwt @{ role = 'service_role'; ref = $ProjectRef }), $false),
    @('SUPABASE_PUBLISHABLE_KEY', (New-FakeJwt @{ role = 'anon'; ref = 'otroproyectoxxxxxxxxx' }), $false),
    @('SUPABASE_SERVICE_ROLE_KEY', (New-FakeJwt @{ role = 'service_role'; ref = $ProjectRef }), $true),
    @('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_valorDePrueba123456', $true),
    @('SUPABASE_SERVICE_ROLE_KEY', (New-FakeJwt @{ role = 'anon'; ref = $ProjectRef }), $false),
    @('SUPABASE_SERVICE_ROLE_KEY', 'sb_publishable_valorDePrueba123456', $false),
    @('SUPABASE_SERVICE_ROLE_KEY', 'con espacios', $false),
    @('SUPABASE_SERVICE_ROLE_KEY', '', $false)
  )
  $bad = 0
  foreach ($c in $cases) {
    $problem = Test-SecretShape $c[0] $c[1]
    $accepted = ($null -eq $problem)
    if ($accepted -ne $c[2]) { $bad++; Write-Host ('FALLO: ' + $c[0] + ' (caso esperado ' + $c[2] + ')') }
  }
  if ($bad -eq 0) { Write-Host ('Prueba interna: ' + $cases.Count + ' casos correctos.') ; exit 0 } else { exit 1 }
}

if (-not $Name) { throw 'Falta -Name (SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_CLIENT_ID o GOOGLE_CLIENT_SECRET).' }
if ($FromLocalEnv -and $Name -ne 'SUPABASE_PUBLISHABLE_KEY') { throw '-FromLocalEnv solo se permite para SUPABASE_PUBLISHABLE_KEY (una llave publica). Los secretos se escriben con entrada oculta.' }

$value = $null
if ($FromLocalEnv) {
  $envFile = Join-Path (Get-Location) '.env.local'
  if (-not (Test-Path $envFile)) { throw 'No existe .env.local en esta carpeta: ejecuta el script desde la raiz del repositorio.' }
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*(?:export\s+)?(?:NEXT_PUBLIC_)?SUPABASE_PUBLISHABLE_KEY\s*=\s*(.+?)\s*$') { $value = $Matches[1].Trim('"').Trim("'"); break }
  }
  if (-not $value) { throw 'No encontre SUPABASE_PUBLISHABLE_KEY en .env.local. Usa el script sin -FromLocalEnv y pega la llave publicable del panel de Supabase.' }
} else {
  $secure = Read-Host -Prompt ('Valor de ' + $Name + ' (no se vera al escribirlo)') -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); $secure.Dispose() }
}

$problem = Test-SecretShape $Name $value
if ($problem) { $value = $null; throw ('No se guardo nada: ' + $problem + '.') }

# El valor se envia a Wrangler por su entrada estandar, SIN salto de linea final, y no se imprime.
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = '/c npx wrangler secret put ' + $Name + ' --env preview'
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.Environment['CI'] = 'true'
$proc = [System.Diagnostics.Process]::Start($psi)
$proc.StandardInput.Write($value)
$proc.StandardInput.Close()
$value = $null
$out = $proc.StandardOutput.ReadToEnd() + $proc.StandardError.ReadToEnd()
$proc.WaitForExit()
if ($proc.ExitCode -ne 0) { Write-Host 'Wrangler no pudo guardar el valor. Revisa que hayas iniciado sesion (npx wrangler whoami).'; exit 1 }
Write-Host ('Listo: ' + $Name + ' guardado en kynova-os-preview (el valor no se mostro ni se guardo en ningun archivo).')
Write-Host 'Nombres presentes ahora (solo nombres):'
cmd.exe /c 'set CI=true&& npx wrangler secret list --env preview' | Select-String '"name"'
