# Builds assets/data/library.json from the library catalog spreadsheet.
#
#   powershell -ExecutionPolicy Bypass -File scripts/build-library-json.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build-library-json.ps1 -Xlsx path\to\catalog.xlsx
#
# Reads the "Library" and "Descriptions" sheets (joined on ID), keeps only rows
# whose Status is OK or Partial (real books), and writes the public fields the
# Bookshelf tab needs. Photo numbers, file names, neighbours, confidence and the
# working notes stay out of the published file. Needs only Windows PowerShell 5.1.

param(
	[string]$Xlsx = (Join-Path $PSScriptRoot "..\assets\Jack_library_catalog.xlsx"),
	[string]$Out = (Join-Path $PSScriptRoot "..\assets\data\library.json")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
$RNS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

function Read-ZipXml([System.IO.Compression.ZipArchive]$zip, [string]$name) {
	$entry = $zip.GetEntry($name)
	if (-not $entry) { throw "Missing $name in workbook" }
	$stream = $entry.Open()
	try {
		$doc = New-Object System.Xml.XmlDocument
		$doc.Load($stream)
		return $doc
	} finally { $stream.Dispose() }
}

function Col-Index([string]$ref) {
	$letters = ($ref -replace "[0-9]", ""); $n = 0
	foreach ($ch in $letters.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - 64) }
	return $n - 1
}

# Returns the sheet as a list of hashtables keyed by the header row.
function Read-Sheet([System.IO.Compression.ZipArchive]$zip, [string]$sheetName, [string[]]$shared) {
	$wb = Read-ZipXml $zip "xl/workbook.xml"
	$nsm = New-Object System.Xml.XmlNamespaceManager($wb.NameTable)
	$nsm.AddNamespace("m", $NS); $nsm.AddNamespace("r", $RNS)
	$sheet = $wb.SelectSingleNode("//m:sheets/m:sheet[@name='$sheetName']", $nsm)
	if (-not $sheet) { throw "Sheet '$sheetName' not found" }
	$rid = $sheet.GetAttribute("id", $RNS)
	$rels = Read-ZipXml $zip "xl/_rels/workbook.xml.rels"
	$target = $null
	foreach ($r in $rels.DocumentElement.ChildNodes) {
		if ($r.GetAttribute("Id") -eq $rid) { $target = $r.GetAttribute("Target") }
	}
	if ($target -notmatch "^xl/") { $target = "xl/" + $target }
	$doc = Read-ZipXml $zip $target
	$n2 = New-Object System.Xml.XmlNamespaceManager($doc.NameTable); $n2.AddNamespace("m", $NS)

	$rows = New-Object System.Collections.Generic.List[object]
	$header = $null
	foreach ($row in $doc.SelectNodes("//m:sheetData/m:row", $n2)) {
		$cells = @{}; $max = -1
		foreach ($c in $row.SelectNodes("m:c", $n2)) {
			$idx = Col-Index $c.GetAttribute("r"); $t = $c.GetAttribute("t")
			$v = $c.SelectSingleNode("m:v", $n2); $val = ""
			if ($t -eq "s" -and $v) { $val = $shared[[int]$v.InnerText] }
			elseif ($t -eq "inlineStr") { $val = (($c.SelectNodes(".//m:t", $n2) | ForEach-Object { $_.InnerText }) -join "") }
			elseif ($v) { $val = $v.InnerText }
			$cells[$idx] = $val; if ($idx -gt $max) { $max = $idx }
		}
		$arr = @(); for ($i = 0; $i -le $max; $i++) { $arr += [string]$cells[$i] }
		if ($null -eq $header) { $header = $arr; continue }
		$h = @{}
		for ($i = 0; $i -lt $header.Count; $i++) { $h[$header[$i]] = if ($i -lt $arr.Count) { $arr[$i] } else { "" } }
		$rows.Add($h)
	}
	return $rows
}

function Json-String([string]$s) {
	$sb = New-Object System.Text.StringBuilder
	[void]$sb.Append('"')
	foreach ($ch in $s.ToCharArray()) {
		switch ($ch) {
			'"' { [void]$sb.Append('\"') }
			'\' { [void]$sb.Append('\\') }
			"`n" { [void]$sb.Append('\n') }
			"`r" { }
			"`t" { [void]$sb.Append('\t') }
			default {
				if ([int]$ch -lt 32) { [void]$sb.AppendFormat('\u{0:x4}', [int]$ch) } else { [void]$sb.Append($ch) }
			}
		}
	}
	[void]$sb.Append('"')
	return $sb.ToString()
}

# First plausible year in a free-text year field; BC years become negative.
function Parse-Year([string]$s) {
	if (-not $s) { return $null }
	$m = [regex]::Match($s, '\b(\d{3,4})\s*BC\b')
	if ($m.Success) { return -[int]$m.Groups[1].Value }
	$m = [regex]::Match($s, '\b(1[0-9]{3}|20[0-9]{2})\b')
	if ($m.Success) { return [int]$m.Groups[1].Value }
	$m = [regex]::Match($s, '\bc\.\s*(\d{3})\b')
	if ($m.Success) { return [int]$m.Groups[1].Value }
	$m = [regex]::Match($s, '^(\d{3})\b')
	if ($m.Success) { return [int]$m.Groups[1].Value }
	return $null
}

function Clean-Title([string]$t) {
	$t = $t -replace '^\(partial\)\s*', ''
	$t = $t -replace '\s*\((?:[^()]*(?:hidden|partly|cut off|continues)[^()]*)\)\s*$', ''
	return $t.Trim()
}

$zip = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $Xlsx))
try {
	$shared = @()
	$ss = Read-ZipXml $zip "xl/sharedStrings.xml"
	$nsm = New-Object System.Xml.XmlNamespaceManager($ss.NameTable); $nsm.AddNamespace("m", $NS)
	foreach ($si in $ss.SelectNodes("//m:sst/m:si", $nsm)) {
		$shared += (($si.SelectNodes(".//m:t", $nsm) | ForEach-Object { $_.InnerText }) -join "")
	}

	$library = Read-Sheet $zip "Library" $shared
	$descs = Read-Sheet $zip "Descriptions" $shared
} finally { $zip.Dispose() }

$descById = @{}
foreach ($d in $descs) { if ($d["ID"]) { $descById[$d["ID"]] = $d } }

# Optional sidecars next to this script:
#   free-texts.json   { "<ID>": { "src": "gutenberg"|"aozora", "url": "...", "note": "..." } }
#   arrangement.json  { "<Unit>|<Shelf>": ["<ID>", ...] }  (exported from the site's Rearrange mode)
$freeTexts = @{}
$freePath = Join-Path $PSScriptRoot "free-texts.json"
if (Test-Path $freePath) {
	$raw = Get-Content $freePath -Raw -Encoding UTF8 | ConvertFrom-Json
	foreach ($p in $raw.PSObject.Properties) { if ($p.Name -notmatch '^_') { $freeTexts[$p.Name] = $p.Value } }
}
$arrangement = @{}
$arrPath = Join-Path $PSScriptRoot "arrangement.json"
if (Test-Path $arrPath) {
	$raw = Get-Content $arrPath -Raw -Encoding UTF8 | ConvertFrom-Json
	foreach ($p in $raw.PSObject.Properties) {
		$parts = $p.Name -split '\|', 2
		for ($i = 0; $i -lt $p.Value.Count; $i++) {
			$arrangement[$p.Value[$i]] = @{ u = $parts[0]; s = $parts[1]; p = $i + 1 }
		}
	}
}

$counts = @{ rows = 0; books = 0; unreadable = 0; objects = 0 }
$items = New-Object System.Collections.Generic.List[string]

foreach ($r in $library) {
	if (-not $r["ID"]) { continue }
	$counts.rows++
	switch ($r["Status"]) {
		"Unreadable" { $counts.unreadable++; continue }
		"Not a book" { $counts.objects++; continue }
	}
	if ($r["Status"] -ne "OK" -and $r["Status"] -ne "Partial") { continue }
	$counts.books++

	$d = $descById[$r["ID"]]
	$yearRaw = if ($d) { $d["Year (first pub. or edition)"] } else { "" }
	$year = Parse-Year $yearRaw
	$desc = if ($d) { $d["Description"] } else { "" }
	if ($desc -match '^Not identified\.') { $desc = "" }

	$unit = $r["Unit"]; $shelf = $r["Shelf"]; $pos = [int]$r["Pos (L to R)"]
	if ($arrangement.ContainsKey($r["ID"])) {
		$a = $arrangement[$r["ID"]]; $unit = $a.u; $shelf = $a.s; $pos = $a.p
	}

	$fields = @(
		('"id":' + (Json-String $r["ID"])),
		('"u":' + (Json-String $unit)),
		('"s":' + (Json-String $shelf)),
		('"p":' + $pos),
		('"t":' + (Json-String (Clean-Title $r["Title"]))),
		('"a":' + (Json-String $r["Author / Editor"])),
		('"pub":' + (Json-String $r["Publisher / Series"])),
		('"l":' + (Json-String $r["Language"])),
		('"ty":' + (Json-String $r["Type"])),
		('"g":' + (Json-String $r["Genre"])),
		('"st":' + (Json-String $r["Status"])),
		('"y":' + $(if ($null -ne $year) { $year } else { "null" })),
		('"yr":' + (Json-String $yearRaw)),
		('"d":' + (Json-String $desc))
	)
	if ($freeTexts.ContainsKey($r["ID"])) {
		$f = $freeTexts[$r["ID"]]
		$ff = '"src":' + (Json-String $f.src) + ',"url":' + (Json-String $f.url)
		if ($f.note) { $ff += ',"note":' + (Json-String $f.note) }
		$fields += ('"free":{' + $ff + '}')
	}
	$items.Add("{" + ($fields -join ",") + "}")
}

$json = "{`n" +
	'"generated":' + (Json-String (Get-Date -Format "yyyy-MM-dd")) + ",`n" +
	'"counts":{"rows":' + $counts.rows + ',"books":' + $counts.books + ',"unreadable":' + $counts.unreadable + ',"objects":' + $counts.objects + "},`n" +
	'"books":[' + "`n" + ($items -join ",`n") + "`n]}`n"

$outPath = $Out
if (-not [System.IO.Path]::IsPathRooted($outPath)) { $outPath = Join-Path (Get-Location).Path $outPath }
$outPath = [System.IO.Path]::GetFullPath($outPath)
New-Item -ItemType Directory -Force (Split-Path $outPath) | Out-Null
[System.IO.File]::WriteAllText($outPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("Wrote {0}: {1} books of {2} rows ({3} unreadable, {4} objects)" -f $outPath, $counts.books, $counts.rows, $counts.unreadable, $counts.objects)
