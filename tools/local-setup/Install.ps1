Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$form=New-Object Windows.Forms.Form;$form.Text='THE FA Core | Local Setup';$form.Size=New-Object Drawing.Size(620,550);$form.StartPosition='CenterScreen';$form.BackColor=[Drawing.Color]::FromArgb(20,20,20);$form.ForeColor=[Drawing.Color]::White;$form.Font=New-Object Drawing.Font('Segoe UI',10)
$title=New-Object Windows.Forms.Label;$title.Text='THE FA Core · 나의 PC 작업실';$title.SetBounds(24,22,550,35);$title.Font=New-Object Drawing.Font('Segoe UI',16,[Drawing.FontStyle]::Bold);$form.Controls.Add($title)
$body=New-Object Windows.Forms.Label;$body.Text="기본: Node.js와 로컬 시험 작업실을 준비합니다.`n이미 설치된 프로그램과 기존 개발 파일은 유지합니다.`n클라우드 로그인·외부 계정 연결·AVA 생성은 별도 기능입니다.";$body.SetBounds(24,68,555,80);$form.Controls.Add($body)
$ai=New-Object Windows.Forms.CheckBox;$ai.Text='Local AI: Ollama + qwen2.5:3b 모델 (추가 다운로드·저장공간 필요)';$ai.SetBounds(24,152,560,35);$form.Controls.Add($ai)
$dev=New-Object Windows.Forms.CheckBox;$dev.Text='개발 도구: Git + Visual Studio Code';$dev.SetBounds(24,193,550,35);$form.Controls.Add($dev)
$consent=New-Object Windows.Forms.CheckBox;$consent.Text='선택한 프로그램의 다운로드·설치 및 각 이용약관에 동의합니다.';$consent.SetBounds(24,242,555,35);$form.Controls.Add($consent)
$links=New-Object Windows.Forms.LinkLabel;$links.Text='설치 목록과 약관 확인 (README)';$links.LinkColor=[Drawing.Color]::LightGoldenrodYellow;$links.SetBounds(24,280,550,30);$links.Add_LinkClicked({Start-Process (Join-Path $PSScriptRoot 'README.txt')});$form.Controls.Add($links)
$status=New-Object Windows.Forms.Label;$status.Text='설치 전에 구성과 약관을 확인해 주세요.';$status.SetBounds(24,330,550,80);$form.Controls.Add($status)
$button=New-Object Windows.Forms.Button;$button.Text='원클릭 설정 시작';$button.SetBounds(24,430,550,50);$button.BackColor=[Drawing.Color]::FromArgb(218,189,143);$button.ForeColor=[Drawing.Color]::Black;$form.Controls.Add($button)
$script:worker=$null;$script:finished=$false;$timer=New-Object Windows.Forms.Timer;$timer.Interval=1000
$button.Add_Click({
 if($script:finished){$form.Close();return}
 if(!$consent.Checked){$status.Text='다운로드·설치와 약관 동의가 필요합니다.';return}
 $button.Enabled=$false;$ai.Enabled=$false;$dev.Enabled=$false;$consent.Enabled=$false
 $args='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'Setup-Worker.ps1')+'" -Consent';if($ai.Checked){$args+=' -LocalAI'};if($dev.Checked){$args+=' -DevelopmentTools'}
 $priorResult=Join-Path $PSScriptRoot 'setup-result.json';if(Test-Path -LiteralPath $priorResult){Remove-Item -LiteralPath $priorResult}
 $script:worker=Start-Process powershell.exe -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'setup.log') -RedirectStandardError (Join-Path $PSScriptRoot 'setup-error.log');$status.Text='선택한 구성 요소를 준비 중입니다. 설치 파일 다운로드는 인터넷 상태에 따라 시간이 걸립니다.';$timer.Start()
})
$timer.Add_Tick({if($script:worker.HasExited){$timer.Stop();try{$result=Get-Content (Join-Path $PSScriptRoot 'setup-result.json') -Raw|ConvertFrom-Json;if($result.status -eq 'LOCAL_READY'){$status.Text='로컬 작업실 준비 완료. 로그인한 Cloud Console과의 연결은 아직 제공하지 않습니다.';Start-Process $result.url}else{$status.Text='설정을 완료하지 못했습니다: '+$result.message}}catch{$status.Text='실행 결과를 확인하지 못했습니다. setup-error.log를 확인해 주세요.'};$button.Text='닫기';$button.Enabled=$true;$script:finished=$true}})
$form.Add_FormClosed({$timer.Stop();$timer.Dispose()})
[void]$form.ShowDialog()
