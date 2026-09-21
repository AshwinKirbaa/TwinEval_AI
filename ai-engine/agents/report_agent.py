import sys


class ReportAgent:

    def generate(self, marks, found, missing, confidence):

        if hasattr(sys.stdout, "reconfigure"):
            try:
                sys.stdout.reconfigure(encoding="utf-8")
            except Exception:
                pass

        print("\n========== AI PAPER EVALUATION REPORT ==========\n")

        # -----------------------------
        # Section-wise Marks
        # -----------------------------
        print("Section-wise Marks")
        print("------------------------------")
        print(f"Concepts       : {marks['Concepts']} / 4")
        print(f"Diagram        : {marks['Diagram']} / 2")
        print(f"Advantages     : {marks['Advantages']} / 2")
        print(f"Conclusion     : {marks['Conclusion']} / 2")

        print("\n------------------------------")
        print(f"Total Marks      : {marks['Total']} / 10")
        print(f"Percentage       : {marks['Percentage']}%")
        print(f"Grade            : {marks['Grade']}")
        print(f"Confidence Score : {confidence}%")

        print("\nCorrect Concepts")

        for concept in found:
            print(f"[+] {concept}")

        print("\nMissing Concepts")

        if missing:
            for concept in missing:
                print(f"[-] {concept}")
        else:
            print("None")

        print("\nReasons")

        if missing:
            for concept in missing:
                print(f"[*] Missing {concept}.")
        else:
            print("No missing concepts.")

        print("\nOverall Remark")
        print(marks["Remark"])