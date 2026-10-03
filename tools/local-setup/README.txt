THE FA Core Windows Local Setup — 검토용 패키지

ZIP 압축을 풀고 Start.cmd를 실행하세요. 구성과 약관을 확인한 뒤 설정 시작을 누르면 선택한 프로그램과 로컬 시험 작업실을 준비합니다.
필수: Node.js 22 이상. 기존 프로그램은 재설치하지 않습니다.
선택: Ollama + qwen2.5:3b 모델, Git, Visual Studio Code.
다운로드 속도·저장공간·관리자 승인·방화벽에 따라 설치가 중단될 수 있습니다. 모든 PC의 무조건 자동 완료를 보장하지 않습니다.
WinGet이 없다면 Microsoft Store의 App Installer를 업데이트해야 합니다.

프로그램/라이선스 정보 (설치 전 확인)
Node.js: https://nodejs.org/en/about/previous-releases | https://github.com/nodejs/node/blob/main/LICENSE
Git: https://git-scm.com/about/free-and-open-source
VS Code: https://code.visualstudio.com/license
Ollama: https://ollama.com/download/windows | https://github.com/ollama/ollama/blob/main/LICENSE
모델: https://ollama.com/library/qwen2.5:3b | https://huggingface.co/Qwen/Qwen2.5-3B-Instruct
Microsoft WinGet: https://learn.microsoft.com/windows/package-manager/winget/install

범위: localhost 전용 보고서·검증·Local AI 요약 시험. Cloud Console과 PC의 자동 연결, 외부 프로그램 원격 조작, 계정 OAuth, AVA 실제 생성은 미구현입니다.
AVA 앱은 준비 중입니다. 로컬 도구와 선택한 기억·권한을 설정하면 향후 AVA가 활용할 범위를 넓힐 수 있도록 계획하고 있습니다. 설치만으로 개인 데이터가 학습되거나 자동 수집되지 않습니다.
로그: setup.log / setup-error.log / setup-result.json. 런타임과 시험 데이터는 LOCALAPPDATA\THEFA\LocalWorkspace\data. 기존 파일·모델·데이터는 삭제하지 않습니다.
